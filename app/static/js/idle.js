// idle.js (45s idle -> add .idle; longer -> navigate /ended)
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('idle') : console;

  const IDLE_MS = 45_000;
  const END_MS  = 5 * 60_000; // auto end after 5 minutes idle

  let idleTimer = null, endTimer = null;

  function reset() {
    document.body.classList.remove('idle');
    if (idleTimer) clearTimeout(idleTimer);
    if (endTimer)  clearTimeout(endTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.add('idle');
    }, IDLE_MS);
    endTimer = setTimeout(() => {
      try {
        const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
        window.API && window.API.sessionEnd && window.API.sessionEnd(sid).catch(()=>{});
      } catch {}
      location.href = '/ended';
    }, END_MS);
  }

  ['pointerdown','keydown','mousemove','touchstart','scroll'].forEach(evt =>
    window.addEventListener(evt, reset, { passive: true })
  );
  reset();

  LOG.info('[idle] timers set');
})();
