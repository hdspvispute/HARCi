// earcon.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('earcon')
    : console;

  let ctx = null;
  let osc = null;
  let gain = null;
  let stopTimer = null;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      LOG.warn('[earcon] WebAudio not available');
      return null;
    }
    ctx = new AC();
    return ctx;
  }

  async function resumeCtx() {
    const c = ensureCtx();
    if (!c) return null;
    try {
      if (c.state === 'suspended') {
        await c.resume();
      }
    } catch (e) {
      // Some browsers require a user gesture; failure is non-fatal here.
      LOG.debug('[earcon] resume skipped/failed', e);
    }
    return c;
  }

  function clearPrev() {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (osc) {
      try { osc.stop(); } catch {}
      try { osc.disconnect(); } catch {}
      osc = null;
    }
    if (gain) {
      try { gain.disconnect(); } catch {}
      gain = null;
    }
  }

  const EARCON = {
    /**
     * Short confirmation chirp.
     * Options:
     *   - freq: number (Hz), default 880
     *   - duration: number (ms), default 120
     *   - level: number (0..1), default 0.03
     */
    async start(opts = {}) {
      const c = await resumeCtx(); if (!c) return;

      const {
        freq = 880,
        duration = 120,
        level = 0.03
      } = opts;

      // Replace any previous tone immediately
      clearPrev();

      osc = c.createOscillator();
      gain = c.createGain();

      // Envelope to avoid clicks (quick fade in/out)
      const now = c.currentTime;
      const onLevel = Math.max(0, Math.min(level, 0.2)); // clamp
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(onLevel, now + 0.01);

      try { osc.frequency.setValueAtTime(freq, now); } catch { osc.frequency.value = freq; }

      osc.connect(gain).connect(c.destination);
      try { osc.start(now); } catch { osc.start(); }

      stopTimer = setTimeout(() => {
        try {
          const t = c.currentTime;
          // quick release
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
          osc.stop(t + 0.03);
        } catch {
          try { osc.stop(); } catch {}
        } finally {
          clearPrev();
        }
      }, duration);

      LOG.info('[earcon] chirp', { freq, duration, level: onLevel });
    },

    stop() {
      clearPrev();
      LOG.debug('[earcon] stopped');
    },

    // Expose a way to proactively unlock audio on a user gesture if needed
    async ensureUnlocked() {
      const c = await resumeCtx();
      if (!c) return false;
      return c.state === 'running';
    }
  };

  window.EARCON = EARCON;
})();
