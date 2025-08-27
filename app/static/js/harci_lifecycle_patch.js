// harci_lifecycle_patch.js
(function () {
  const g = window; if (!g) return;

  g.UI = g.UI || {};
  g.UI.setStatus = g.UI.setStatus || (s => { g.UI.status = s; try { const el = document.getElementById('statusText'); if (el) el.textContent = s; } catch {} });

  // Central speech controller
  const SPEECH = {
    speaking: false,
    ticket: 0,     // increments per play
    // harci_lifecycle_patch.js  (replace the stop() body)
    stop(reason = 'user') {
      try { g.HARCI_AVATAR?.stopSpeaking?.(); } catch {}
      this.speaking = false;
      // If we're starting a chip request, keep whatever status UI set (“Thinking…”).
      if (reason !== 'chip') {
        g.UI.setStatus('Ready');
      }
    }

  };
  g.HARCI_SPEECH = SPEECH;

  function estimateMs(text) {
    const t = (text||'').trim();
    if (!t) return 1200;
    const w = t.split(/\s+/).length;
    const ms = Math.min(25_000, Math.max(1200, Math.round((w / 2.5) * 1000))); // ~2.5 wps
    return ms;
  }

  // Non-blocking speak with safety timeout
  g.speakSafe = async function speakSafe(text, opts={}) {
    const my = ++SPEECH.ticket;
    SPEECH.speaking = true;
    g.UI.setStatus('Speaking…');

    let timeout = null;
    const done = () => {
      if (my !== SPEECH.ticket) return;     // superseded by newer speak
      SPEECH.speaking = false;
      g.UI.setStatus('Ready');
      if (timeout) clearTimeout(timeout);
    };

    try {
      const ms = estimateMs(text);
      timeout = setTimeout(done, ms + 1500);

      // If your avatar API supports a promise, await it; otherwise fire-and-forget
      const maybePromise = g.HARCI_AVATAR?.speak?.(text);
      if (maybePromise && typeof maybePromise.then === 'function') {
        await maybePromise.catch(()=>{});
      }
    } catch {}
    finally { done(); }
  };
})();
