// stt.js (hold-to-talk using Speech SDK)
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('stt') : console;

  const listeners = {};
  function emit(evt, payload) { (listeners[evt] || []).forEach(fn => fn(payload)); }

  let recognizer = null;
  let tokenCache = null;

  async function getAuth() {
    if (tokenCache && (tokenCache.expiresAt * 1000 - Date.now() > 60_000)) {
      return tokenCache;
    }
    const tok = await window.API.speechToken();
    tokenCache = tok;
    return tok;
  }

  const STT = {
    on(evt, fn){ (listeners[evt] = listeners[evt] || []).push(fn); },

    async beginHold() {
      const S = window.SpeechSDK;
      if (!S) throw new Error('SpeechSDK missing');

      const { token, region } = await getAuth();
      const speechConfig = S.SpeechConfig.fromAuthorizationToken(token, region);

      const cfg = (window.HARCI_CONFIG || {});
      speechConfig.speechRecognitionLanguage = cfg.speechLang || 'en-US';

      const audioConfig = S.AudioConfig.fromDefaultMicrophoneInput();
      recognizer = new S.SpeechRecognizer(speechConfig, audioConfig);

      recognizer.recognizing = (_, e) => emit('partial', { text: e.result.text || '' });
      recognizer.recognized  = (_, e) => emit('partial', { text: e.result.text || '' });
      recognizer.sessionStopped = () => LOG.info('[stt] sessionStopped');

      return new Promise((resolve, reject) => {
        try {
          recognizer.startContinuousRecognitionAsync(() => {
            LOG.info('[stt] beginHold started');
            resolve();
          }, (err) => reject(err));
        } catch (e) { reject(e); }
      });
    },

    async endHold() {
      if (!recognizer) return { text: '' };
      LOG.info('[stt] endHold stopped');
      return new Promise((resolve) => {
        recognizer.stopContinuousRecognitionAsync(() => {
          recognizer.recognizeOnceAsync((res) => {
            const text = (res && res.text) || '';
            try { recognizer.close(); } catch {}
            recognizer = null;
            resolve({ text });
          }, (err) => {
            LOG.error('[stt] recognizeOnce error', err);
            try { recognizer.close(); } catch {}
            recognizer = null;
            resolve({ text: '' });
          });
        }, () => {
          try { recognizer.close(); } catch {}
          recognizer = null;
          resolve({ text: '' });
        });
      });
    }
  };

  window.HARCI_STT = STT;
})();
