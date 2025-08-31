// app/static/js/speak_safe.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('speech')
    : console;

  // --- tiny helper ------------------------------------------------------------
  function estimateMs(text) {
    const t = String(text || '').trim();
    if (!t) return 1200;
    const w = t.split(/\s+/).length;
    // ~2.5 words/sec, clamp to a sane window
    return Math.min(25_000, Math.max(1200, Math.round((w / 2.5) * 1000)));
  }

  // --- shared speech controller (used by UI to pre-empt) ----------------------
  const SPEECH = {
    speaking: false,
    ticket: 0, // increments on each play or preemption

    stop(reason = 'user') {
      // Invalidate any pending speakSafe completions
      this.ticket++;
      try { window.HARCI_AVATAR?.stopSpeaking?.(); } catch {}
      this.speaking = false;

      // Don’t clobber UI during chip/PTT transitions
      if (reason !== 'chip' && reason !== 'ptt') {
        try { window.UI?.setStatus?.('Ready'); } catch {}
      }
    }
  };
  window.HARCI_SPEECH = SPEECH;

  // --- main guarded speak -----------------------------------------------------
  async function speakSafe(text, opts = {}) {
    const my = ++SPEECH.ticket;
    const phrase = String(text || '').trim();
    const { timeoutMs } = opts;

    // Ensure any previous TTS is stopped first
    try { await window.HARCI_AVATAR?.stopSpeaking?.(); } catch {}

    // If pre-empted before we even start, bail quietly
    if (my !== SPEECH.ticket) return;

    // If nothing to say, just mark ready
    if (!phrase) {
      if (my === SPEECH.ticket) {
        SPEECH.speaking = false;
        try { window.UI?.setStatus?.('Ready'); } catch {}
      }
      return;
    }

    SPEECH.speaking = true;
    try { window.UI?.setStatus?.('Speaking…'); } catch {}

    let timer = null;
    const finish = () => {
      if (my !== SPEECH.ticket) return;      // newer speech took over
      SPEECH.speaking = false;
      if (timer) clearTimeout(timer);
      try { window.UI?.setStatus?.('Ready'); } catch {}
    };

    try {
      // Safety timeout in case SDK never calls back
      const ms = (typeof timeoutMs === 'number' ? timeoutMs : (estimateMs(phrase) + 1500));
      timer = setTimeout(finish, ms);

      const p = window.HARCI_AVATAR?.speak?.(phrase);
      if (p && typeof p.then === 'function') {
        await p;              // resolved when synthesis completes
      }
    } catch (e) {
      LOG.warn('[speech] speakSafe error', e);
    } finally {
      finish();
    }
  }

  window.speakSafe = speakSafe;
})();
