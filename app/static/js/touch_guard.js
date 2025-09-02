// touch_guard.js – mic long-press guard for Samsung/Android
(() => {
  const mic = document.getElementById('btnHoldMic');
  if (!mic) return;

  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); return false; };

  // Always block these directly on the mic
  ['contextmenu','dragstart','selectstart','gesturestart'].forEach(ev => {
    mic.addEventListener(ev, swallow, { capture: true });
  });

  let pressed = false;
  const docBlock = (e) => { if (pressed) { e.preventDefault(); e.stopPropagation(); } };

  const startPress = (e) => {
    // Ensure the browser knows we've handled the gesture
    swallow(e);
    pressed = true;
    try { mic.setPointerCapture?.(e.pointerId); } catch {}
    // While held, kill any context menu anywhere
    document.addEventListener('contextmenu', docBlock, { capture: true });
    document.addEventListener('selectstart', docBlock, { capture: true });
  };

  const endPress = (e) => {
    swallow(e);
    pressed = false;
    document.removeEventListener('contextmenu', docBlock, { capture: true });
    document.removeEventListener('selectstart', docBlock, { capture: true });
  };

  // Prefer pointer events; fall back to mouse/touch
  mic.addEventListener('pointerdown', startPress, { passive: false });
  mic.addEventListener('pointerup', endPress, { passive: false });
  mic.addEventListener('pointercancel', endPress, { passive: false });
  mic.addEventListener('lostpointercapture', endPress, { passive: false });

  // Extra safety for older stacks
  mic.addEventListener('touchstart', startPress, { passive: false });
  mic.addEventListener('touchend', endPress, { passive: false });
  mic.addEventListener('mousedown', startPress, { passive: false });
  mic.addEventListener('mouseup', endPress, { passive: false });
})();
