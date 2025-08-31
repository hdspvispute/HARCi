// app/static/js/speak_safe.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('speech') : console;
  let ticket = 0;

  async function speakSafe(text, opts = {}) {
    const my = ++ticket;

    // Stop any current avatar speech first
    try { await window.HARCI_AVATAR?.stopSpeaking?.(); } catch {}

    // If someone else started after us, abort
    if (my !== ticket) return;

    try {
      await window.HARCI_AVATAR?.speak?.(String(text || ''));
    } catch (e) {
      LOG.warn('[speech] speakSafe error', e);
    }
  }

  window.speakSafe = speakSafe;
})();
