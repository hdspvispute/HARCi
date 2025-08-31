// app/static/js/avatar_rtc.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('avatar')
    : console;

  // ---------------------------------------------------------------------------
  // Cached DOM refs
  // ---------------------------------------------------------------------------
  var $video = null;
  var $audio = null;

  // ---------------------------------------------------------------------------
  // WebRTC + Synth state
  // ---------------------------------------------------------------------------
  var synth = null;
  var pc = null;
  var sessionActive = false;

  // Output mute flag (applies to media elements + receiver tracks)
  var outputMuted = false;

  // Last known config/tokens (used across reconnects)
  var lastCfg = null;
  var lastSpeechToken = null;
  var lastRelay = null;

  // Reconnect control
  var reconnecting = false;
  var iceFailTimer = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function fetchJson(url) { return fetch(url).then(function (r) { return r.json(); }); }

  async function fetchCfgAndTokens() {
    var results = await Promise.all([
      fetchJson('/api/config'),
      fetchJson('/speech-token'),
      fetchJson('/relay-token').catch(function () { return {}; })
    ]);
    var cfg = results[0] || {};
    var st  = results[1] || {};
    var rt  = results[2] || {};
    lastCfg = cfg;
    lastSpeechToken = st;
    lastRelay = rt;
    return { cfg: cfg, st: st, rt: rt };
  }

  async function unlockAudioPlayback() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      await ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      LOG.info('[avatar] Audio unlocked');
    } catch (e) {
      LOG.warn('[avatar] Audio unlock failed (will rely on user gesture):', e);
    }
  }

  // Central pronunciation tweaks
  function fixPronunciation(s) {
    s = String(s || '');
    return s
      .replace(/\bHARCi(?:'|’)[sS]\b/g, 'Harkee’s')
      .replace(/\bHARC(?:'|’)[sS]\b/g, 'Hark’s')
      .replace(/\bHARCi\b/gi, 'Harkee')
      .replace(/\bHARC\b/gi, 'Hark');
  }

  // ---------------------------------------------------------------------------
  // Output mute helpers
  // ---------------------------------------------------------------------------
  function applyOutputMuteToElements(on) {
    try {
      if ($audio) $audio.muted = on;
      if ($video) $video.muted = on;
    } catch (e) {}
  }

  function applyOutputMuteToReceivers(on) {
    try {
      if (pc && typeof pc.getReceivers === 'function') {
        pc.getReceivers().forEach(function (r) {
          if (r && r.track && r.track.kind === 'audio') {
            // Disabling the receiver's audio track prevents any audio energy rendering.
            r.track.enabled = !on;
          }
        });
      }
    } catch (e) {
      if (LOG.debug && typeof LOG.debug === 'function') LOG.debug('[avatar] receiver mute not applied', e);
    }
  }

  function setOutputMuted(on) {
    outputMuted = !!on;
    applyOutputMuteToElements(outputMuted);
    applyOutputMuteToReceivers(outputMuted);
  }

  // ---------------------------------------------------------------------------
  // ICE / RTCPeerConnection helpers
  // ---------------------------------------------------------------------------
  function buildPcConfig(relay) {
    var haveTurn = !!(relay && relay.Urls && relay.Urls.length);
    var iceServers = haveTurn
      ? [{ urls: relay.Urls, username: relay.Username, credential: relay.Password }]
      : [{ urls: ['stun:stun.l.google.com:19302'] }];

    return {
      cfg: {
        iceServers: iceServers,
        iceTransportPolicy: haveTurn ? 'relay' : 'all'
      },
      haveTurn: haveTurn
    };
  }

  function attachPcEventLogging(_pc) {
    _pc.onconnectionstatechange = function () {
      var s = _pc.connectionState;
      LOG.info('[avatar] pc.connectionState =>', s);
      if (s === 'failed') scheduleReconnect('state-failed');
    };

    _pc.oniceconnectionstatechange = function () {
      var st = _pc.iceConnectionState;
      LOG.info('[avatar] pc.iceConnectionState =>', st);
      if (iceFailTimer) { clearTimeout(iceFailTimer); iceFailTimer = null; }
      if (st === 'disconnected') {
        // transient disconnects are common; wait before deciding to reconnect
        iceFailTimer = setTimeout(function () { scheduleReconnect('ice-disconnected'); }, 3000);
      } else if (st === 'failed') {
        scheduleReconnect('ice-failed');
      }
    };
  }

  async function startAvatarOnPc(_pc, S, avcfg) {
    // Receive-only (explicit)
    try { _pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (e) {}
    try { _pc.addTransceiver('video', { direction: 'recvonly' }); } catch (e) {}

    attachPcEventLogging(_pc);

    _pc.ontrack = function (ev) {
      var stream = ev && ev.streams && ev.streams[0];
      if (!stream) return;

      if (ev.track && ev.track.kind === 'video' && $video) {
        $video.srcObject = stream;
        $video.muted = outputMuted;
        $video.playsInline = true;
        if ($video.play) $video.play().catch(function () {});
      }

      if (ev.track && ev.track.kind === 'audio' && $audio) {
        $audio.srcObject = stream;
        $audio.muted = outputMuted;
        $audio.volume = 1.0;
        $audio.playsInline = true;
        if ($audio.play) $audio.play().catch(function () {});
      }

      // Ensure receiver tracks reflect current mute state
      setTimeout(function () { applyOutputMuteToReceivers(outputMuted); }, 0);
    };

    // Start the avatar WebRTC connection (API variants across SDKs)
    if (synth && typeof synth.startAvatarAsync === 'function') {
      await synth.startAvatarAsync(_pc);
    } else if (synth && typeof synth.enableWebrtc === 'function' && typeof synth.createAvatarWebRTCConnection === 'function') {
      await synth.enableWebrtc();
      await synth.createAvatarWebRTCConnection(_pc, avcfg);
    } else if (synth && typeof synth.enableWebRTC === 'function' && typeof synth.createAvatarWebRTCConnectionAsync === 'function') {
      await synth.enableWebRTC();
      await synth.createAvatarWebRTCConnectionAsync(_pc, avcfg);
    } else {
      throw new Error('No compatible start method found on AvatarSynthesizer');
    }
  }

  async function scheduleReconnect(reason) {
    if (!sessionActive || reconnecting) return;
    reconnecting = true;
    LOG.warn('[avatar] scheduling reconnect due to', reason);

    try {
      // Tear down current PC (leave synth alive; restart onto a new PC)
      if (pc) {
        try { pc.ontrack = null; pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; } catch (e) {}
        try { pc.close(); } catch (e) {}
      }
      pc = null;

      // Try to refresh relay token (it can expire)
      try {
        lastRelay = await fetchJson('/relay-token');
      } catch (e) {
        // keep previous (could be empty)
      }

      // First attempt: prefer TURN if available
      var confA = buildPcConfig(lastRelay);
      var pcCfg = confA.cfg;
      pc = new RTCPeerConnection(pcCfg);

      try {
        await startAvatarOnPc(pc, window.SpeechSDK, (synth && synth.__avcfg) || null);
      } catch (e1) {
        LOG.warn('[avatar] reconnect attempt with policy=', pcCfg.iceTransportPolicy, 'failed:', e1);

        // Fallback attempt: try 'all' (stun) if relay path failed
        try { pc.close(); } catch (e) {}
        pc = null;

        pcCfg = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], iceTransportPolicy: 'all' };
        pc = new RTCPeerConnection(pcCfg);
        await startAvatarOnPc(pc, window.SpeechSDK, (synth && synth.__avcfg) || null);
      }

      LOG.info('[avatar] reconnected with policy=', (pc.getConfiguration && pc.getConfiguration().iceTransportPolicy) || 'unknown');
    } catch (e) {
      LOG.error('[avatar] reconnect failed:', e);
    } finally {
      reconnecting = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------
  async function startSession() {
    if (sessionActive) return;
    sessionActive = true;

    var startBtn = document.getElementById('btnStartSession') || document.getElementById('btnSessionToggle');
    if (startBtn) startBtn.disabled = true;

    try {
      var S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK not loaded');

      await unlockAudioPlayback();

      var bundle = await fetchCfgAndTokens();
      var cfg = bundle.cfg || {};
      var st  = bundle.st || {};
      var rt  = bundle.rt || {};

      var sc = S.SpeechConfig.fromAuthorizationToken(st.token, st.region);
      sc.speechSynthesisLanguage  = cfg.speechLang  || 'en-US';
      sc.speechSynthesisVoiceName = cfg.speechVoice || 'en-US-JennyNeural';

      // Optional: video profile for the avatar
      var vf    = new S.AvatarVideoFormat('h264', 1500000, 640, 360); // (no numeric separator)
      var avcfg = new S.AvatarConfig(cfg.avatarId || 'lisa', cfg.avatarStyle || 'casual-sitting', vf);

      if (rt && rt.Urls && rt.Urls.length) {
        avcfg.remoteIceServers = [{ urls: rt.Urls, username: rt.Username, credential: rt.Password }];
      } else {
        LOG.warn('[avatar] /relay-token is empty — TURN is recommended for reliable A/V');
      }

      synth = new S.AvatarSynthesizer(sc, avcfg);
      // Keep a ref for reconnect flows
      synth.__avcfg = avcfg;

      // Visibility into lifecycle
      synth.synthesisStarted   = function () { LOG.info('[avatar] synthesisStarted'); };
      synth.synthesizing       = function () { LOG.info('[avatar] synthesizing…'); };
      synth.synthesisCompleted = function (s, e) { LOG.info('[avatar] synthesisCompleted', e && e.result && e.result.reason); };
      synth.synthesisCanceled  = function (s, e) { LOG.error('[avatar] synthesisCanceled:', (e && (e.errorDetails || e))); };
      synth.visemeReceived     = function (s, e) { LOG.info('[avatar] viseme', e && e.visemeId); };
      synth.bookmarkReached    = function (s, e) { LOG.info('[avatar] bookmark', e && e.text); };

      $video = document.getElementById('remoteVideo');
      $audio = document.getElementById('remoteAudio');
      if (!$video || !$audio) throw new Error('Missing #remoteVideo/#remoteAudio');

      var conf = buildPcConfig(rt);
      var pcCfg = conf.cfg;
      pc = new RTCPeerConnection(pcCfg);

      // TURN presence logging
      try {
        var cfgPC = pc.getConfiguration ? pc.getConfiguration() : { iceServers: [] };
        var servers = cfgPC.iceServers || [];
        var hasTurn = servers.some(function (s) {
          var u = (s && (s.urls || s.url)) || '';
          return /(turn:|turns:)/i.test(String(u));
        });
        console.info('[HARCi] TURN available:', hasTurn, 'policy=', cfgPC.iceTransportPolicy || 'default');
        if (!hasTurn && cfgPC.iceTransportPolicy === 'relay') {
          console.warn('[HARCi] policy=relay but no TURN servers present; expect connection failures if relay required.');
        }
      } catch (e) { console.debug('[HARCi] TURN check skipped', e); }

      await startAvatarOnPc(pc, S, avcfg);

      LOG.info('[avatar] session started');
      setTimeout(function () { if (startBtn) startBtn.disabled = false; }, 1000);
    } catch (err) {
      LOG.error('[avatar] session start error:', err);
      try { if (window.UI && window.UI.setStatus) window.UI.setStatus('Failed to start'); } catch (e) {}
      if (startBtn) startBtn.disabled = false;
      sessionActive = false;
    }
  }

  async function speak(text) {
    if (!synth) throw new Error('Avatar not started');
    var t = String(text || '').trim();
    if (!t) return;

    var fixed = fixPronunciation(t);
    LOG.info('[avatar] speak: attempting:', fixed);

    // Return a promise so callers can await and manage status
    return new Promise(function (resolve, reject) {
      try {
        synth.speakTextAsync(
          fixed,
          function () { LOG.info('[avatar] speak: completed'); resolve(); },
          function (err) { LOG.error('[avatar] speak: error:', err); reject(err); }
        );
      } catch (e) {
        LOG.error('[avatar] speak: threw', e);
        reject(e);
      }
    });
  }

  async function stopSpeaking() {
    try { if (synth && typeof synth.stopSpeakingAsync === 'function') await synth.stopSpeakingAsync(); } catch (e) {}
  }

  async function end() {
    try { if (synth && typeof synth.stopAvatarAsync === 'function') await synth.stopAvatarAsync(); } catch (e) {}
    try { if (pc && typeof pc.close === 'function') pc.close(); } catch (e) {}
    synth = null;
    pc = null;
    sessionActive = false;
    reconnecting = false;
    if (iceFailTimer) { clearTimeout(iceFailTimer); iceFailTimer = null; }
    // Reset mute state so next session starts clean
    outputMuted = false;
    $video = null;
    $audio = null;
  }

  // Public API
  window.HARCI_AVATAR = {
    startSession: startSession,
    speak:        speak,
    stopSpeaking: stopSpeaking,
    end:          end,
    ensureAudioUnlocked: unlockAudioPlayback,
    setOutputMuted: setOutputMuted
  };
})();
