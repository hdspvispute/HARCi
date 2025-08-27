(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('stt') : console;

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch(e){ console.warn('[stt] listener err', e); } }); }

  let recognizer = null;
  let tokenCache = null;

  let lastPartial = '', lastFinal = '';
  let started = false;
  let isStarting = false;
  let isStopping = false;

  async function getAuth() {
    if (tokenCache && (tokenCache.expiresAt * 1000 - Date.now() > 60_000)) return tokenCache;
    const tok = await window.API.speechToken(); tokenCache = tok; return tok;
  }

  function cleanupRecognizer(){
    try { recognizer?.close(); } catch {}
    recognizer = null; started = false;
  }

  const DRAIN_MS = 300;
  const STOP_TIMEOUT_MS = 2000;

  const STT = {
    on,

    async beginHold() {
      if (isStarting) { LOG.debug('[stt] beginHold ignored (isStarting)'); return; }
      if (recognizer && started) { LOG.debug('[stt] beginHold ignored (already started)'); return; }

      // Preempt avatar speech
      try { if (window.HARCI_SPEECH?.speaking) window.HARCI_SPEECH.stop?.('ptt'); } catch {}

      const S = window.SpeechSDK; if (!S) throw new Error('SpeechSDK missing');
      if (recognizer && !started) { LOG.warn('[stt] recognizer existed on beginHold; cleaning up.'); cleanupRecognizer(); }

      isStarting = true;
      try {
        const { token, region } = await getAuth();
        const speechConfig = S.SpeechConfig.fromAuthorizationToken(token, region);
        const cfg = (window.HARCI_CONFIG || {});
        speechConfig.speechRecognitionLanguage = cfg.speechLang || 'en-US';
        try {
          speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '1500');
          speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '500');
        } catch {}
        const audioConfig = S.AudioConfig.fromDefaultMicrophoneInput();
        recognizer = new S.SpeechRecognizer(speechConfig, audioConfig);

        lastPartial = ''; lastFinal = ''; started = false;

        recognizer.recognizing = (_, e) => {
          const t = e?.result?.text || ''; if (!t) return; lastPartial = t; emit('partial', { text: t });
        };
        recognizer.recognized = (_, e) => {
          const r = e?.result; if (!r) return;
          if (r.reason === S.ResultReason.RecognizedSpeech && r.text) { lastFinal = r.text; emit('final', { text: r.text }); }
        };
        recognizer.canceled = (_, e) => { LOG.warn('[stt] canceled event', e?.reason, e?.errorDetails); };
        recognizer.sessionStarted = () => LOG.info('[stt] sessionStarted');
        recognizer.sessionStopped = () => LOG.info('[stt] sessionStopped');

        await new Promise((resolve, reject) => {
          try {
            recognizer.startContinuousRecognitionAsync(
              () => { started = true; try { window.UI?.setStatus?.('Listening'); } catch {}; resolve(); },
              (err) => { LOG.error('[stt] startContinuousRecognitionAsync error', err); cleanupRecognizer(); reject(err); }
            );
          } catch (e) { cleanupRecognizer(); reject(e); }
        });
      } finally {
        isStarting = false;
      }
    },

    async endHold() {
      if (!recognizer) { try { window.UI?.setStatus?.('Idle'); } catch {}; return { text: '' }; }
      if (isStopping)  { LOG.debug('[stt] endHold ignored (isStopping)'); return { text: '' }; }

      isStopping = true;
      LOG.info('[stt] endHold stopping…');

      const stopPromise = new Promise((resolveStop) => {
        let resolved = false;
        const resolveSafe = () => { if (resolved) return; resolved = true; resolveStop(); };
        try {
          recognizer.stopContinuousRecognitionAsync(
            () => { setTimeout(resolveSafe, DRAIN_MS); },
            (err) => { LOG.error('[stt] stop error', err); resolveSafe(); }
          );
        } catch (e) { LOG.error('[stt] stop threw', e); resolveSafe(); }
      });

      const timeout = new Promise(r => setTimeout(r, STOP_TIMEOUT_MS));
      await Promise.race([stopPromise, timeout]);

      const text = (lastFinal || lastPartial || '').trim();
      cleanupRecognizer();
      isStopping = false;

      try { window.UI?.setStatus?.('Idle'); } catch {}
      return { text };
    }
  };

  window.HARCI_STT = STT;
})();
