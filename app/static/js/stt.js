// app/static/js/stt.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('stt') : console;

  // --- Event bus --------------------------------------------------------------
  const listeners = {};
  function on(evt, fn) { (listeners[evt] = (listeners[evt] || [])).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.warn('[stt] listener err', e); } });
  }

  // --- State ------------------------------------------------------------------
  let recognizer = null;
  let tokenCache = null;

  let lastPartial = '', lastFinal = '', started = false;
  let stopping = false;         // reentrancy guard for endHold()
  let sessionActive = false;    // whether we've warmed the mic for this session

  // Hidden, persistent mic stream to keep permissions/DSP active all session.
  // We DO NOT pipe this stream to the SDK directly (keeps compatibility stable);
  // the SDK will still use the default system mic, but cold-start risk is gone.
  let persistentStream = null;

  // --- Helpers ----------------------------------------------------------------
  async function getAuth() {
    // Reuse token if >60s buffer remains
    if (tokenCache && (tokenCache.expiresAt * 1000 - Date.now() > 60_000)) return tokenCache;
    const tok = await window.API.speechToken();
    tokenCache = tok;
    return tok;
  }

  function cleanupRecognizer() {
    try { recognizer?.close(); } catch {}
    recognizer = null;
    started = false;
    stopping = false;
  }

  async function warmMicStream() {
    // Already warm and alive?
    if (persistentStream?.active) return persistentStream;

    try {
      // Ask with sane DSP flags; browsers often keep these profiles active
      // while the stream is alive (echoCancellation etc).
      persistentStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });

      // If device changes or the track ends (BT switch, OS revoke), drop and re-warm.
      persistentStream.getTracks().forEach(t => {
        t.addEventListener('ended', () => {
          LOG.warn('[stt] persistent track ended; will require re-warm');
          persistentStream = null;
        });
      });
      LOG.info('[stt] mic warmed for session');
    } catch (e) {
      LOG.warn('[stt] mic warm failed/denied; STT will still try on hold', e);
      persistentStream = null;
    }
    return persistentStream;
  }

  // If input devices change during session, re-acquire warm stream.
  try {
    navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
      if (!sessionActive) return;
      try { persistentStream?.getTracks()?.forEach(t => t.stop()); } catch {}
      persistentStream = null;
      await warmMicStream();
    });
  } catch {}

  const DRAIN_MS = 300, STOP_TIMEOUT_MS = 2000;

  // --- Public API -------------------------------------------------------------
  const STT = {
    /**
     * Subscribe to STT events.
     * - 'partial': { text }
     * - 'final'  : { text }
     */
    on,

    /**
     * Call once when the user starts a session.
     * Keeps a hidden mic stream open so press-to-talk starts instantly and reliably.
     */
    async warmup() {
      sessionActive = true;
      await warmMicStream();
    },

    /**
     * Begin press-to-talk capture. Preempts avatar speech.
     * Emits 'partial' and 'final' events while active.
     */
    async beginHold() {
      // Preempt avatar speech (caller should also mute output path if desired).
      try {
        if (window.HARCI_SPEECH?.speaking) window.HARCI_SPEECH.stop?.('ptt');
      } catch {}

      const S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK missing');

      // Ensure mic is warm (no-op if already active)
      await warmMicStream();

      // If a previous recognizer leaked, clean it safely.
      if (recognizer) {
        LOG.warn('[stt] recognizer existed on beginHold; cleaning up');
        cleanupRecognizer();
      }

      const { token, region } = await getAuth();
      if (!token || !region) throw new Error('Speech token/region missing');

      const speechConfig = S.SpeechConfig.fromAuthorizationToken(token, region);

      const cfg = (window.HARCI_CONFIG || {});
      speechConfig.speechRecognitionLanguage = cfg.speechLang || 'en-US';

      // Make results feel more natural and avoid clipping first/last words
      try {
        speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '2000');
        speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '800');
        speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_KeepConnectionAlive, 'true');
        // Normalize numbers, casing, etc. (safe noop if not supported)
        speechConfig.setProperty(S.PropertyId.SpeechServiceResponse_PostProcessingOption, 'TrueText');
      } catch {}

      // Default mic input (we only keep a separate warm stream alive)
      const audioConfig = S.AudioConfig.fromDefaultMicrophoneInput();

      recognizer = new S.SpeechRecognizer(speechConfig, audioConfig);
      lastPartial = '';
      lastFinal = '';
      started = false;
      stopping = false;

      // Events
      recognizer.recognizing = (_, e) => {
        const t = e?.result?.text || '';
        if (!t) return;
        lastPartial = t;
        emit('partial', { text: t });
      };

      recognizer.recognized = (_, e) => {
        const r = e?.result;
        if (!r) return;
        if (r.reason === S.ResultReason.RecognizedSpeech && r.text) {
          lastFinal = r.text;
          emit('final', { text: r.text });
        }
      };

      recognizer.canceled = (_, e) => {
        LOG.warn('[stt] canceled event', e?.reason, e?.errorDetails);
      };
      recognizer.sessionStarted = () => LOG.info('[stt] sessionStarted');
      recognizer.sessionStopped = () => LOG.info('[stt] sessionStopped');

      // Start
      return new Promise((resolve, reject) => {
        try {
          recognizer.startContinuousRecognitionAsync(
            () => { started = true; try { window.UI?.setStatus?.('Listening'); } catch {}; resolve(); },
            (err) => { LOG.error('[stt] startContinuousRecognitionAsync error', err); cleanupRecognizer(); reject(err); }
          );
        } catch (e) {
          cleanupRecognizer();
          reject(e);
        }
      });
    },

    /**
     * End press-to-talk capture and return the best text (final > partial).
     * { text }
     */
    async endHold() {
      if (!recognizer || !started) {
        try { window.UI?.setStatus?.('Idle'); } catch {}
        return { text: '' };
      }
      if (stopping) {
        LOG.info('[stt] endHold already in progress — ignoring');
        return { text: '' };
      }
      stopping = true;
      LOG.info('[stt] endHold stopping…');

      const stopPromise = new Promise((resolveStop) => {
        let resolved = false;
        const resolveSafe = () => { if (resolved) return; resolved = true; resolveStop(); };
        try {
          recognizer.stopContinuousRecognitionAsync(
            () => { setTimeout(resolveSafe, DRAIN_MS); },
            (err) => { LOG.error('[stt] stop error', err); resolveSafe(); }
          );
        } catch (e) {
          LOG.error('[stt] stop threw', e);
          resolveSafe();
        }
      });

      const timeout = new Promise(r => setTimeout(r, STOP_TIMEOUT_MS));
      await Promise.race([stopPromise, timeout]).catch(() => {});

      const text = (lastFinal || lastPartial || '').trim();
      cleanupRecognizer();
      try { window.UI?.setStatus?.('Idle'); } catch {}
      return { text };
    },

    /**
     * End of session — release hidden mic and recognizer.
     */
    async dispose() {
      sessionActive = false;
      cleanupRecognizer();
      try { persistentStream?.getTracks()?.forEach(t => t.stop()); } catch {}
      persistentStream = null;
      LOG.info('[stt] disposed');
    },

    /**
     * Optional: let UI check whether mic is warmed.
     */
    isWarmed() {
      return !!(persistentStream?.active);
    }
  };

  window.HARCI_STT = STT;
})();
