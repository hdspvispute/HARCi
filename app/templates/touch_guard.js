// app/static/js/touch_guard.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('touch')
    : console;

  // Elements we want to “feel like buttons” on mobile
  const SEL = [
    '.btn', '.btn-brand', '.btn-outline', '.btn-plain',
    '.btn-mic-rect', '#btnHoldMic',
    '.chip',
    'button',
    '[role="button"]',
    '[data-no-callout]'
  ].join(',');

  function harden(el) {
    if (!el || el.__touchHardened) return;
    el.__touchHardened = true;

    const isHold = el.matches('.btn-mic-rect, #btnHoldMic');
    const isGenericBtn = el.matches('.btn, .btn-brand, .btn-outline, .btn-plain');

    // Visual feedback class on press (purely cosmetic)
    const addPressed = () => {
      if (isHold || isGenericBtn) el.classList.add('is-pressed');
    };
    const rmPressed = () => el.classList.remove('is-pressed');

    // Attributes/styles that help across browsers
    el.setAttribute('draggable', 'false');
    if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'off');
    try {
      el.style.webkitTapHighlightColor = 'transparent';
      el.style.webkitUserSelect = 'none';
      el.style.userSelect = 'none';
      // For the hold-to-talk mic we go stricter to avoid long-press/zoom entirely.
      el.style.touchAction = isHold ? 'none' : 'manipulation';
      el.style.webkitTouchCallout = 'none';
    } catch {}

    // Kill context menu / selection / drag on target and its kids
    const block = (e) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('contextmenu', block, { capture: true });
    el.addEventListener('selectstart', block, { capture: true });
    el.addEventListener('dragstart',   block, { capture: true });

    // iOS pinch/force menu sometimes lands here
    el.addEventListener('gesturestart', (e) => { try { e.preventDefault(); } catch {} }, { capture: true });

    // Strict iOS long-press guard for the mic button
    // (Use non-passive so we can call preventDefault without warnings)
    if (isHold) {
      el.addEventListener('touchstart', (e) => {
        // Prevent iOS callout/share sheet & double-tap zoom on the mic
        e.preventDefault();
        addPressed();
      }, { passive: false });

      el.addEventListener('touchend',   () => rmPressed(), { passive: true });
      el.addEventListener('touchcancel',() => rmPressed(), { passive: true });
    }

    // Pointer press visuals (keeps regular click semantics)
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture?.(e.pointerId); } catch {}
      addPressed();
    }, { passive: true });

    const end = () => rmPressed();
    ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach((evt) =>
      el.addEventListener(evt, end, { passive: true })
    );

    // Keyboard affordances for accessibility
    el.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') addPressed();
    });
    el.addEventListener('keyup', rmPressed);
  }

  function hardenAll(root = document) {
    root.querySelectorAll(SEL).forEach(harden);
  }

  // Initial pass
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hardenAll());
  } else {
    hardenAll();
  }

  // Watch for dynamically added buttons (desktop/mobile swaps, rerenders)
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes && m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches && n.matches(SEL)) harden(n);
        if (n.querySelectorAll) hardenAll(n);
      });
    }
  });
  try {
    mo.observe(document.documentElement, { subtree: true, childList: true });
  } catch (e) {
    LOG.warn('[touch] MutationObserver failed', e);
  }

  // Global safety nets (if an inner element receives the event)
  const globalBlock = (e) => {
    const el = e.target.closest?.(SEL);
    if (el) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener('contextmenu', globalBlock, { capture: true });
  window.addEventListener('selectstart', globalBlock, { capture: true });

  LOG.info('[touch] guard armed');
})();
