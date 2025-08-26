// earcon.js (simple chime for mic start/stop)
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('earcon') : console;
  let ctx = null, osc = null;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  const EARCON = {
    start() {
      const c = ensureCtx(); if (!c) return;
      if (osc) { try { osc.stop(); } catch {} osc = null; }
      osc = c.createOscillator();
      const gain = c.createGain(); gain.gain.value = 0.03;
      osc.frequency.value = 880;
      osc.connect(gain).connect(c.destination);
      osc.start();
      setTimeout(() => {
        if (osc) {
          try { osc.stop(); } catch {}
          osc = null;
        }
      }, 120);
    },
    stop() {
      if (osc) {
        try { osc.stop(); } catch {}
        osc = null;
      }
    }
  };

  window.EARCON = EARCON;
})();
