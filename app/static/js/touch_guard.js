// app/static/js/touch_guard.js – mic long-press guard + telemetry
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('touch')
    : console;

  const mic = document.getElementById('btnHoldMic');
  if (!mic) return;

  // --- Helpers ---------------------------------------------------------------
  const swallow = (e, why) => {
    try { LOG.warn?.('gesture.block', { why, type: e.type }); } catch {}
    e.preventDefault(); e.stopPropagation();
    return false;
  };

  let pressed = false;
  let preventedCnt = 0;
  let t0 = 0;

  const docBlock = (e) => {
    if (!pressed) return;
    preventedCnt++;
    e.preventDefault(); e.stopPropagation();
  };

  const addPressedState = () => {
    mic.classList.add('is-pressed');
    mic.setAttribute('aria-pressed', 'true');
  };
  const clearPressedState = () => {
    mic.classList.remove('is-pressed');
    mic.setAttribute('aria-pressed', 'false');
  };

  // Always block these directly on the mic element
  ['contextmenu','dragstart','selectstart','gesturestart'].forEach(ev => {
    mic.addEventListener(ev, (e) => { preventedCnt++; swallow(e, 'mic-direct'); }, { capture: true });
  });

  // During a hold, also block at the document level (covers OEM quirks)
  const bindDocGuards = () => {
    document.addEventListener('contextmenu', docBlock, { capture: true });
    document.addEventListener('selectstart', docBlock, { capture: true });
    // Some Android builds route long-press via pointercancel → contextmenu
    document.addEventListener('pointercancel', docBlock, { capture: true });
  };
  const unbindDocGuards = () => {
    document.removeEventListener('contextmenu', docBlock, { capture: true });
    document.removeEventListener('selectstart', docBlock, { capture: true });
    document.removeEventListener('pointercancel', docBlock, { capture: true });
  };

  const startPress = (e) => {
    swallow(e, 'press-start');
    pressed = true;
    preventedCnt = 0;
    t0 = performance.now();
    addPressedState();
    try { if (e.pointerId != null) mic.setPointerCapture(e.pointerId); } catch {}
    bindDocGuards();
    try { LOG.event?.('mic.hold.start'); } catch {}
  };

  const endPress = (e) => {
    swallow(e, 'press-end');
    const dur = Math.max(0, performance.now() - t0);
    pressed = false;
    clearPressedState();
    unbindDocGuards();
    try { LOG.event?.('mic.hold.end', { ms: Math.round(dur), prevented: preventedCnt }); } catch {}
    preventedCnt = 0;
  };

  // Prefer Pointer Events; fall back to touch/mouse for older stacks
  mic.addEventListener('pointerdown', startPress,   { passive: false });
  mic.addEventListener('pointerup',   endPress,     { passive: false });
  mic.addEventListener('pointercancel', endPress,   { passive: false });
  mic.addEventListener('lostpointercapture', endPress, { passive: false });

  // Extra safety for older stacks
  mic.addEventListener('touchstart', startPress, { passive: false });
  mic.addEventListener('touchend',   endPress,   { passive: false });
  mic.addEventListener('mousedown',  startPress, { passive: false });
  mic.addEventListener('mouseup',    endPress,   { passive: false });

  // Prevent accidental double-tap zoom on iOS over the mic area
  mic.addEventListener('dblclick', (e) => swallow(e, 'dblclick'), { passive: false });

  // Optional: if button somehow receives keyboard activation, prevent text selection
  mic.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') swallow(e, 'kbd-block');
  }, { capture: true });

  // One-time log
  try { LOG.info?.('guard.ready'); } catch {}
})();
