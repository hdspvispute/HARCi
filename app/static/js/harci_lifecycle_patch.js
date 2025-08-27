// harci_lifecycle_patch.js
(function () {
  const g = window; if (!g) return;

  g.UI = g.UI || {};
  g.UI.setStatus = g.UI.setStatus || (s => {
    g.UI.status = s;
    try {
      const el = document.getElementById('statusText') || document.getElementById('status');
      if (el) el.textContent = s;
    } catch {}
  });

  // Central speech controller
  const SPEECH = {
    speaking: false,
    ticket: 0,     // increments per play or preemption

    stop(reason = 'user') {
      // Invalidate any pending speakSafe timeouts from earlier speech
      this.ticket++;
      try { g.HARCI_AVATAR?.stopSpeaking?.(); } catch {}
      this.speaking = false;

      // Don't clobber UI during chip/PTT thinking phases
      if (reason !== 'chip' && reason !== 'ptt') {
        g.UI.setStatus('Ready');
      }
    }
  };
  g.HARCI_SPEECH = SPEECH;

  function estimateMs(text) {
    const t = (text||'').trim();
    if (!t) return 1200;
    const w = t.split(/\s+/).length;
    return Math.min(25_000, Math.max(1200, Math.round((w / 2.5) * 1000))); // ~2.5 wps
  }

  // Non-blocking speak with safety timeout + ticketing
  g.speakSafe = async function speakSafe(text, opts = {}) {
    const my = ++SPEECH.ticket;
    SPEECH.speaking = true;
    g.UI.setStatus('Speaking…');

    let timeout = null;
    const done = () => {
      // If a newer speech started (ticket changed), don't touch the UI
      if (my !== SPEECH.ticket) return;
      SPEECH.speaking = false;
      g.UI.setStatus('Ready');
      if (timeout) clearTimeout(timeout);
    };

    try {
      const ms = estimateMs(text);
      timeout = setTimeout(done, ms + 1500);

      const maybePromise = g.HARCI_AVATAR?.speak?.(text);
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise.catch(()=>{});
      }
    } catch {}
    finally { done(); }
  };
})();
