// idle.js — Guide-only idle handling.
// 45s -> add .idle on <body>; 5m -> end session + redirect to /ended.
(() => {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('idle') : console;

  const IS_GUIDE = !!document.getElementById('remoteVideo'); // only arm on guide
  if (!IS_GUIDE) {
    LOG.info('[idle] not on guide; timers not armed');
    return;
  }

  const IDLE_MS = 45_000;
  const END_MS  = 5 * 60_000;

  let idleTimer = null;
  let endTimer  = null;
  let ended     = false;

  const isSessionActive = () => !!window.__harci_sessionActive;

  async function endSessionAndLeave() {
    if (ended) return;
    ended = true;
    try {
      const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
      await (window.API?.sessionEnd?.(sid));
    } catch {}
    location.href = '/ended';
  }

  function clearTimers() {
    if (idleTimer) clearTimeout(idleTimer);
    if (endTimer)  clearTimeout(endTimer);
    idleTimer = endTimer = null;
  }

  function armTimers() {
    clearTimers();

    // Add subtle “dim” after IDLE_MS (only if session is active)
    idleTimer = setTimeout(() => {
      if (isSessionActive()) document.body.classList.add('idle');
    }, IDLE_MS);

    // Fully end after END_MS (only if session is active)
    endTimer = setTimeout(() => {
      if (isSessionActive()) endSessionAndLeave();
    }, END_MS);
  }

  function reset() {
    document.body.classList.remove('idle');
    armTimers();
  }

  // Arm on load
  armTimers();

  // Interaction signals that should reset idle timers
  const EVENTS = [
    'pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'
  ];
  EVENTS.forEach(evt => window.addEventListener(evt, reset, { passive: true }));

  // If the page becomes visible again, reset timers; if hidden, let them continue.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reset();
  });

  // Proactively end the session on navigation away (best effort)
  const sendKeepalive = () => {
    try {
      const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
      window.API?.sessionEnd?.(sid);
    } catch {}
  };
  window.addEventListener('pagehide', sendKeepalive);
  window.addEventListener('beforeunload', sendKeepalive);

  LOG.info('[idle] timers armed (guide)');
})();
