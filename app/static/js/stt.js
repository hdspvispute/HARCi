// stt.js (hold-to-talk using Speech SDK) — DROP-IN PATCH (safe, minimal, robust)
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('stt') : console;

  const listeners = {};
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch(e){ console.warn('[stt] listener err', e); } }); }

  let recognizer = null;
  let tokenCache = null;

  // Track latest hypotheses so endHold can return something even if the last packet is late.
  let lastPartial = '';
  let lastFinal = '';
  let started = false;

  async function getAuth() {
    if (tokenCache && (tokenCache.expiresAt * 1000 - Date.now() > 60_000)) {
      return tokenCache;
    }
    const tok = await window.API.speechToken();
    tokenCache = tok;
    return tok;
  }

  function cleanupRecognizer() {
    try { recognizer?.close(); } catch {}
    recognizer = null;
    started = false;
  }

  // Small grace to allow final 'recognized' to arrive after stopContinuousRecognitionAsync callback
  const DRAIN_MS = 300;
  const STOP_TIMEOUT_MS = 2000;

  const STT = {
    on,

    async beginHold() {
      // If avatar is still speaking, politely preempt so the user can talk
      try { if (window.HARCI_SPEECH?.speaking) window.HARCI_SPEECH.stop?.('ptt'); } catch {}

      const S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK missing');

      if (recognizer) {
        // Safety: if something was left open, close and restart cleanly.
        LOG.warn('[stt] recognizer existed on beginHold; cleaning up.');
        cleanupRecognizer();
      }

      const { token, region } = await getAuth();
      const speechConfig = S.SpeechConfig.fromAuthorizationToken(token, region);

      const cfg = (window.HARCI_CONFIG || {});
      speechConfig.speechRecognitionLanguage = cfg.speechLang || 'en-US';

      // OPTIONAL low-latency niceties (safe to keep; remove if undesired)
      try {
        speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '1500');
        speechConfig.setProperty(S.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '500');
      } catch {}

      const audioConfig = S.AudioConfig.fromDefaultMicrophoneInput();
      recognizer = new S.SpeechRecognizer(speechConfig, audioConfig);

      lastPartial = '';
      lastFinal = '';
      started = false;

      recognizer.recognizing = (_, e) => {
        const t = e?.result?.text || '';
        if (!t) return;
        lastPartial = t;
        emit('partial', { text: t });
      };

      recognizer.recognized = (_, e) => {
        const r = e?.result;
        if (!r) return;
        // Only commit "final" on real recognitions
        if (r.reason === S.ResultReason.RecognizedSpeech) {
          if (r.text) {
            lastFinal = r.text;
            emit('final', { text: r.text });
          }
        } else if (r.reason === S.ResultReason.Canceled) {
          LOG.warn('[stt] Canceled:', r.cancellationDetails?.reason, r.cancellationDetails?.errorDetails);
        }
      };

      recognizer.canceled = (_, e) => {
        LOG.warn('[stt] canceled event', e?.reason, e?.errorDetails);
      };

      recognizer.sessionStopped = () => LOG.info('[stt] sessionStopped');

      return new Promise((resolve, reject) => {
        try {
          recognizer.startContinuousRecognitionAsync(() => {
            started = true;
            LOG.info('[stt] beginHold started');
            try { window.UI?.setStatus?.('Listening'); } catch {}
            resolve();
          }, (err) => {
            LOG.error('[stt] startContinuousRecognitionAsync error', err);
            cleanupRecognizer();
            reject(err);
          });
        } catch (e) {
          cleanupRecognizer();
          reject(e);
        }
      });
    },

    async endHold() {
      if (!recognizer) {
        LOG.info('[stt] endHold: no recognizer');
        try { window.UI?.setStatus?.('Idle'); } catch {}
        return { text: '' };
      }

      LOG.info('[stt] endHold stopping…');

      // Wrap stop with a timeout so we never hang here
      const stopPromise = new Promise((resolveStop) => {
        let resolved = false;

        const resolveSafe = () => {
          if (resolved) return;
          resolved = true;
          resolveStop();
        };

        try {
          recognizer.stopContinuousRecognitionAsync(() => {
            // Allow a brief drain so the last 'recognized' event can land
            setTimeout(resolveSafe, DRAIN_MS);
          }, (err) => {
            LOG.error('[stt] stopContinuousRecognitionAsync error', err);
            resolveSafe();
          });
        } catch (e) {
          LOG.error('[stt] stop threw', e);
          resolveSafe();
        }

        // Absolute stop timeout
        setTimeout(() => {
          LOG.warn('[stt] stop timeout hit');
          resolveSafe();
        }, STOP_TIMEOUT_MS);
      });

      await stopPromise;

      const text = (lastFinal || lastPartial || '').trim();

      cleanupRecognizer();
      try { window.UI?.setStatus?.('Idle'); } catch {}

      LOG.info('[stt] endHold resolved with:', text ? `"${text}"` : '(empty)');
      return { text };
    }
  };

  window.HARCI_STT = STT;
})();
