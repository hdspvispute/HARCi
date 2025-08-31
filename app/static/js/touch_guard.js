// app/static/js/touch_guard.js
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child)
    ? window.HARCI_LOG.child('touch')
    : console;

  // Any element matching these selectors will be "hardened"
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

    // Visual feedback class on press for big mic / buttons
    const addPressed = () => {
      if (el.matches('.btn-mic-rect, #btnHoldMic, .btn')) el.classList.add('is-pressed');
    };
    const rmPressed = () => el.classList.remove('is-pressed');

    // Attributes that help across browsers
    el.setAttribute('draggable', 'false');
    el.setAttribute('aria-live', el.getAttribute('aria-live') || 'off');
    try {
      el.style.webkitTapHighlightColor = 'transparent';
      // Don’t rely solely on CSS classes; force it here too
      el.style.webkitUserSelect = 'none';
      el.style.userSelect = 'none';
      el.style.touchAction = 'manipulation';
      el.style.webkitTouchCallout = 'none';
    } catch {}

    // Block context menus / text selection / drags
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
    el.addEventListener('selectstart', (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
    el.addEventListener('dragstart',   (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });

    // Some mobile browsers emit a pinch "gesturestart" event
    el.addEventListener('gesturestart', (e) => { try { e.preventDefault(); } catch {} }, { capture: true });

    // Pointer press visuals (does NOT change your app logic)
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture?.(e.pointerId); } catch {}
      addPressed();
    }, { passive: true });

    const end = () => rmPressed();
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) =>
      el.addEventListener(evt, end, { passive: true })
    );
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

  // Watch for dynamically added buttons (e.g., ID swaps desktop/mobile)
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

  // Global safety nets (in case something slips through)
  window.addEventListener('contextmenu', (e) => {
    const el = e.target.closest?.(SEL);
    if (el) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  window.addEventListener('selectstart', (e) => {
    const el = e.target.closest?.(SEL);
    if (el) { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  LOG.info('[touch] guard armed');
})();
