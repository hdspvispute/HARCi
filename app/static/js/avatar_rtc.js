// avatar_rtc.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('avatar')
    : console;

  async function fetchCfgAndTokens() {
    const [cfg, st, rt] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/speech-token').then(r => r.json()),
      fetch('/relay-token').then(r => r.json()).catch(() => ({})),
    ]);
    return { cfg, st, rt };
  }

  async function unlockAudioPlayback() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      LOG.info('[avatar] Audio unlocked');
    } catch (e) {
      LOG.warn('[avatar] Audio unlock failed (will rely on user gesture):', e);
    }
  }

  let synth = null;
  let pc = null;
  let sessionActive = false;

  async function startSession() {
    if (sessionActive) return;
    sessionActive = true;

    const startBtn = document.getElementById('btnStartSession');
    if (startBtn) startBtn.disabled = true;

    try {
      const S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK not loaded');

      await unlockAudioPlayback();

      const { cfg, st, rt } = await fetchCfgAndTokens();

      const sc = S.SpeechConfig.fromAuthorizationToken(st.token, st.region);
      sc.speechSynthesisLanguage  = cfg.speechLang  || 'en-US';
      sc.speechSynthesisVoiceName = cfg.speechVoice || 'en-US-JennyNeural';

      // Optional: video profile for the avatar
      const vf    = new S.AvatarVideoFormat('h264', 1_500_000, 640, 360);
      const avcfg = new S.AvatarConfig(cfg.avatarId || 'lisa', cfg.avatarStyle || 'casual-sitting', vf);

      if (rt?.Urls?.length) {
        avcfg.remoteIceServers = [{ urls: rt.Urls, username: rt.Username, credential: rt.Password }];
      } else {
        LOG.warn('[avatar] /relay-token is empty — TURN is required for reliable A/V');
      }

      synth = new S.AvatarSynthesizer(sc, avcfg);

      // Visibility into lifecycle
      synth.synthesisStarted   = () => LOG.info('[avatar] synthesisStarted');
      synth.synthesizing       = () => LOG.info('[avatar] synthesizing…');
      synth.synthesisCompleted = (s, e) => LOG.info('[avatar] synthesisCompleted', e?.result?.reason);
      synth.synthesisCanceled  = (s, e) => LOG.error('[avatar] synthesisCanceled:', e?.errorDetails || e);
      synth.visemeReceived     = (s, e) => LOG.info('[avatar] viseme', e?.visemeId);
      synth.bookmarkReached    = (s, e) => LOG.info('[avatar] bookmark', e?.text);

      const video = document.getElementById('remoteVideo');
      const audio = document.getElementById('remoteAudio');
      if (!video || !audio) throw new Error('Missing #remoteVideo/#remoteAudio');

      // PeerConnection (force relay when provided)
      const iceServers = (avcfg.remoteIceServers ?? []).length
        ? avcfg.remoteIceServers
        : [{ urls: ['stun:stun.l.google.com:19302'] }];

      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });

      // TURN presence logging
      try {
        const cfgPC = pc.getConfiguration ? pc.getConfiguration() : { iceServers: [] };
        const servers = cfgPC.iceServers || [];
        const haveTurn = servers.some(s => /(turn:|turns:)/i.test(String(s.urls || s.url || '')));
        console.info('[HARCi] TURN available:', haveTurn, 'policy=', cfgPC.iceTransportPolicy || 'default');
        if (!haveTurn && (cfgPC.iceTransportPolicy === 'relay')) {
          console.warn('[HARCi] policy=relay but no TURN servers present; expect connection failures if relay required.');
        }
      } catch (e) { console.debug('[HARCi] TURN check skipped', e); }

      // Receive-only (explicit)
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
          video.play?.().catch(()=>{});
        }
        if (ev.track.kind === 'audio') {
          audio.srcObject = stream;
          audio.muted = false;
          audio.volume = 1.0;
          audio.playsInline = true;
          audio.play?.().catch(()=>{});
        }
      };

      // Start the avatar WebRTC connection (API variants across SDKs)
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
      setTimeout(() => { if (startBtn) startBtn.disabled = false; }, 1000);
    } catch (err) {
      LOG.error('[avatar] session start error:', err);
      try { window.UI?.setStatus?.('Failed to start'); } catch {}
      if (startBtn) startBtn.disabled = false;
      sessionActive = false;
    }
  }

  async function speak(text) {
    if (!synth) throw new Error('Avatar not started');
    const t = String(text || '').trim();
    if (!t) return;
    LOG.info('[avatar] speak: attempting:', t);
    // Return a promise so callers can await and manage status
    return new Promise((resolve, reject) => {
      try {
        synth.speakTextAsync(
          t,
          () => { LOG.info('[avatar] speak: completed'); resolve(); },
          (err) => { LOG.error('[avatar] speak: error:', err); reject(err); }
        );
      } catch (e) {
        LOG.error('[avatar] speak: threw', e);
        reject(e);
      }
    });
  }

  async function stopSpeaking() {
    try { await synth?.stopSpeakingAsync?.(); } catch {}
  }

  async function end() {
    try { await synth?.stopAvatarAsync?.(); } catch {}
    try { pc?.close?.(); } catch {}
    synth = null;
    pc = null;
    sessionActive = false;
  }

  window.HARCI_AVATAR = {
    startSession,
    speak,
    stopSpeaking,
    end,
    ensureAudioUnlocked: unlockAudioPlayback,
  };
})();
