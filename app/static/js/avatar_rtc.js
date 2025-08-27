// avatar_rtc.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('avatar')
    : console;

  // ---- Safe UI helpers (never assume globals) --------------------------------
  function setUIStatus(s) {
    try {
      if (window.UI && typeof window.UI.setStatus === 'function') {
        window.UI.setStatus(s);
      } else if (typeof window.setStatus === 'function') {
        window.setStatus(s);
      } else {
        // last-resort: write into #status / #statusText if present
        const el = document.getElementById('statusText') || document.getElementById('status');
        if (el) el.textContent = s;
      }
    } catch {}
  }

  // ---- Audio unlock (idempotent) --------------------------------------------
  let _audioCtx;
  async function unlockAudioPlayback() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!_audioCtx && Ctx) _audioCtx = new Ctx();
      if (!_audioCtx) return;
      await _audioCtx.resume();

      // short, silent blip to satisfy autoplay policies
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(_audioCtx.destination);
      osc.start();
      osc.stop(_audioCtx.currentTime + 0.02);
      LOG.info('[avatar] Audio unlocked');
    } catch (e) {
      LOG.warn('[avatar] Audio unlock failed (will rely on user gesture):', e);
    }
  }

  // ---- State ----------------------------------------------------------------
  let synth = null;                 // SpeechSDK.AvatarSynthesizer
  let pc = null;                    // RTCPeerConnection
  let sessionActive = false;
  let speakTicket = 0;              // preemption token for overlapping speaks

  // ---- Helpers ---------------------------------------------------------------
  function hasTurn(iceServers) {
    return (iceServers || []).some(s => {
      const u = s && (s.urls || s.url);
      const list = Array.isArray(u) ? u : [u];
      return list.filter(Boolean).some(x => /^(turns?:)/i.test(String(x)));
    });
  }

  async function fetchCfgAndTokens() {
    const [cfg, st, rt] = await Promise.all([
      window.API.config(),
      window.API.speechToken(),
      window.API.relayToken().catch(() => ({})), // optional
    ]);
    return { cfg, st, rt };
  }

  // ---- Public API ------------------------------------------------------------
  async function startSession() {
    if (sessionActive) {
      LOG.info('[avatar] session already active');
      return;
    }
    sessionActive = true;
    const startBtn = document.getElementById('btnStartSession');
    if (startBtn) startBtn.disabled = true;

    try {
      const S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK not loaded');

      await unlockAudioPlayback();

      const { cfg, st, rt } = await fetchCfgAndTokens();

      // Speech config
      const sc = S.SpeechConfig.fromAuthorizationToken(st.token, st.region);
      sc.speechSynthesisLanguage  = cfg.speechLang  || 'en-US';
      sc.speechSynthesisVoiceName = cfg.speechVoice || 'en-US-JennyNeural';

      // Avatar config
      const vf    = new S.AvatarVideoFormat('h264', 1_500_000, 640, 360);
      const avcfg = new S.AvatarConfig(cfg.avatarId || 'lisa', cfg.avatarStyle || 'casual-sitting', vf);

      if (rt?.Urls?.length) {
        avcfg.remoteIceServers = [{
          urls: rt.Urls,
          username: rt.Username,
          credential: rt.Password
        }];
      } else {
        LOG.warn('[avatar] /relay-token empty; TURN strongly recommended for reliability');
      }

      const video = document.getElementById('remoteVideo');
      const audio = document.getElementById('remoteAudio');
      if (!video || !audio) throw new Error('Missing #remoteVideo/#remoteAudio');

      // Build RTCPeerConnection, prefer TURN if present; otherwise allow STUN.
      const iceServers = (avcfg.remoteIceServers ?? []).length
        ? avcfg.remoteIceServers
        : [{ urls: ['stun:stun.l.google.com:19302'] }];

      pc = new RTCPeerConnection({
        iceServers,
        // if TURN present, relay-only gives more predictable behavior through strict networks
        iceTransportPolicy: hasTurn(iceServers) ? 'relay' : 'all',
      });

      // visibility logs
      try {
        const cfgNow = pc.getConfiguration ? pc.getConfiguration() : { iceServers: [] };
        LOG.info('[HARCi] TURN available:', hasTurn(cfgNow.iceServers), 'policy=', cfgNow.iceTransportPolicy || 'default');
      } catch {}

      // Receive-only
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.onconnectionstatechange = () => LOG.info('[avatar] pc.connectionState =>', pc.connectionState);
      pc.oniceconnectionstatechange = () => LOG.info('[avatar] pc.iceConnectionState =>', pc.iceConnectionState);

      pc.ontrack = (ev) => {
        const stream = ev.streams?.[0];
        if (!stream) return;
        if (ev.track.kind === 'video') {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          video.play?.().catch(() => {});
        }
        if (ev.track.kind === 'audio') {
          audio.srcObject = stream;
          audio.muted = false;
          audio.volume = 1.0;
          audio.playsInline = true;
          audio.play?.().catch(() => {});
        }
      };

      // Synthesizer
      synth = new S.AvatarSynthesizer(sc, avcfg);

      // Diagnostics (non-intrusive)
      synth.synthesisStarted   = () => LOG.info('[avatar] synthesisStarted');
      synth.synthesizing       = () => LOG.info('[avatar] synthesizing…');
      synth.synthesisCompleted = (s, e) => LOG.info('[avatar] synthesisCompleted', e?.result?.reason);
      synth.synthesisCanceled  = (s, e) => LOG.error('[avatar] synthesisCanceled:', e?.errorDetails || e);
      synth.visemeReceived     = (s, e) => LOG.info('[avatar] viseme', e?.visemeId);
      synth.bookmarkReached    = (s, e) => LOG.info('[avatar] bookmark', e?.text);

      // Start avatar (support multiple SDK shapes)
      if (typeof synth.startAvatarAsync === 'function') {
        await synth.startAvatarAsync(pc);
      } else if (typeof synth.enableWebrtc === 'function' && typeof synth.createAvatarWebRTCConnection === 'function') {
        await synth.enableWebrtc();
        await synth.createAvatarWebRTCConnection(pc, avcfg);
      } else if (typeof synth.enableWebRTC === 'function' && typeof synth.createAvatarWebRTCConnectionAsync === 'function') {
        await synth.enableWebRTC();
        await synth.createAvatarWebRTCConnectionAsync(pc, avcfg);
      } else {
        throw new Error('No compatible start method found on AvatarSynthesizer');
      }

      LOG.info('[avatar] session started');
      setUIStatus('Ready');
    } catch (err) {
      LOG.error('[avatar] session start error:', err);
      setUIStatus('Failed to start');
      sessionActive = false;
      throw err;
    } finally {
      if (startBtn) setTimeout(() => { startBtn.disabled = false; }, 800);
    }
  }

  async function speak(text) {
    if (!synth) throw new Error('Avatar not started');
    const t = String(text || '').trim();
    if (!t) return;

    // Preempt: stop any current speech before starting a new one
    const my = ++speakTicket;
    try { await stopSpeaking(); } catch {}

    LOG.info('[avatar] speak: attempting:', t);
    try {
      // Some SDK builds return a promise; others require callbacks.
      await new Promise((resolve, reject) => {
        if (!synth) return resolve(); // already torn down
        const maybe = synth.speakTextAsync(t, resolve, reject);
        // if the SDK returns a thenable, prefer it
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(resolve).catch(reject);
        }
      });
      if (my !== speakTicket) {
        LOG.debug('[avatar] speak superseded');
        return;
      }
      LOG.info('[avatar] speak: completed');
    } catch (err) {
      if (my !== speakTicket) return; // superseded; ignore
      LOG.error('[avatar] speak: error:', err);
    }
  }

  async function stopSpeaking() {
    try { await synth?.stopSpeakingAsync?.(); } catch {}
  }

  async function end() {
    try { await stopSpeaking(); } catch {}
    try { await synth?.stopAvatarAsync?.(); } catch {}
    try { pc?.getSenders?.().forEach(s => { try { s.track?.stop?.(); } catch {} }); } catch {}
    try { pc?.getReceivers?.().forEach(r => { try { r.track?.stop?.(); } catch {} }); } catch {}
    try { pc?.close?.(); } catch {}

    synth = null;
    pc = null;
    sessionActive = false;
    LOG.info('[avatar] session ended');
  }

  // NOTE: We intentionally removed MediaRecorder / mic capture here.
  // Hold-to-talk and STT are handled solely by stt.js to avoid duplicate
  // microphone access and the "setStatus is not defined" errors you saw.

  window.HARCI_AVATAR = {
    startSession,
    speak,
    stopSpeaking,
    end,
    ensureAudioUnlocked: unlockAudioPlayback,
  };
})();
