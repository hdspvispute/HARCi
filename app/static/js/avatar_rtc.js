// app/static/js/avatar_rtc.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('avatar')
    : console;

  // Cached DOM refs (set on session start / first ontrack)
  let $video = null;
  let $audio = null;

  // WebRTC + Synth state
  let synth = null;
  let pc = null;
  let sessionActive = false;

  // Output mute flag (applies to elements + receiver tracks)
  let outputMuted = false;

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

  // --- Pronunciation normalization (centralized) -----------------------------
  function fixPronunciation(s = '') {
    // Handle possessives first (smart or straight apostrophes)
    return String(s)
      .replace(/\bHARCi(?:'|’)[sS]\b/g, 'Harkee’s')
      .replace(/\bHARC(?:'|’)[sS]\b/g,  'Hark’s')
      // Plain words (case-insensitive)
      .replace(/\bHARCi\b/gi, 'Harkee')
      .replace(/\bHARC\b/gi,  'Hark');
  }

  // --- Output mute helper ----------------------------------------------------
  function applyOutputMuteToElements(on) {
    try {
      if ($audio) $audio.muted = on;
      if ($video) $video.muted = on;
    } catch {}
  }
  function applyOutputMuteToReceivers(on) {
    try {
      if (pc && typeof pc.getReceivers === 'function') {
        pc.getReceivers().forEach(r => {
          if (r.track && r.track.kind === 'audio') {
            // Disabling the receiver track ensures no audio energy is rendered at all.
            r.track.enabled = !on;
          }
        });
      }
    } catch (e) {
      LOG.debug?.('[avatar] receiver mute not applied', e);
    }
  }
  function setOutputMuted(on) {
    outputMuted = !!on;
    applyOutputMuteToElements(outputMuted);
    applyOutputMuteToReceivers(outputMuted);
  }

  // --- Session lifecycle -----------------------------------------------------
  async function startSession() {
    if (sessionActive) return;
    sessionActive = true;

    const startBtn = document.getElementById('btnStartSession') || document.getElementById('btnSessionToggle');
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
        LOG.warn('[avatar] /relay-token is empty — TURN is recommended for reliable A/V');
      }

      synth = new S.AvatarSynthesizer(sc, avcfg);

      // Visibility into lifecycle
      synth.synthesisStarted   = () => LOG.info('[avatar] synthesisStarted');
      synth.synthesizing       = () => LOG.info('[avatar] synthesizing…');
      synth.synthesisCompleted = (s, e) => LOG.info('[avatar] synthesisCompleted', e?.result?.reason);
      synth.synthesisCanceled  = (s, e) => LOG.error('[avatar] synthesisCanceled:', e?.errorDetails || e);
      synth.visemeReceived     = (s, e) => LOG.info('[avatar] viseme', e?.visemeId);
      synth.bookmarkReached    = (s, e) => LOG.info('[avatar] bookmark', e?.text);

      $video = document.getElementById('remoteVideo');
      $audio = document.getElementById('remoteAudio');
      if (!$video || !$audio) throw new Error('Missing #remoteVideo/#remoteAudio');

      // Build ICE config dynamically:
      // - If we have TURN credentials from /relay-token, prefer relay.
      // - Else fall back to default policy.
      const haveTurn = Array.isArray(avcfg.remoteIceServers) && avcfg.remoteIceServers.length > 0;
      const iceServers = haveTurn
        ? avcfg.remoteIceServers
        : [{ urls: ['stun:stun.l.google.com:19302'] }];

      const pcConfig = {
        iceServers,
        iceTransportPolicy: haveTurn ? 'relay' : 'all'
      };

      pc = new RTCPeerConnection(pcConfig);

      // TURN presence logging
      try {
        const cfgPC = pc.getConfiguration ? pc.getConfiguration() : { iceServers: [] };
        const servers = cfgPC.iceServers || [];
        const hasTurn = servers.some(s => /(turn:|turns:)/i.test(String(s.urls || s.url || '')));
        console.info('[HARCi] TURN available:', hasTurn, 'policy=', cfgPC.iceTransportPolicy || 'default');
        if (!hasTurn && (cfgPC.iceTransportPolicy === 'relay')) {
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

        if (ev.track.kind === 'video' && $video) {
          $video.srcObject = stream;
          $video.muted = outputMuted;      // honor current mute state
          $video.playsInline = true;
          $video.play?.().catch(()=>{});
        }

        if (ev.track.kind === 'audio' && $audio) {
          $audio.srcObject = stream;
          $audio.muted = outputMuted;      // honor current mute state
          $audio.volume = 1.0;
          $audio.playsInline = true;
          $audio.play?.().catch(()=>{});
        }

        // Ensure receiver tracks reflect current mute state
        setTimeout(() => applyOutputMuteToReceivers(outputMuted), 0);
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

    const fixed = fixPronunciation(t);
    LOG.info('[avatar] speak: attempting:', fixed);

    // Return a promise so callers can await and manage status
    return new Promise((resolve, reject) => {
      try {
        synth.speakTextAsync(
          fixed,
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
    // Reset mute state so next session starts clean
    outputMuted = false;
    $video = null;
    $audio = null;
  }

  // Public API
  window.HARCI_AVATAR = {
    startSession,
    speak,
    stopSpeaking,
    end,
    ensureAudioUnlocked: unlockAudioPlayback,
    // 🔥 used by UI to gate output during STT
    setOutputMuted,
  };
})();
