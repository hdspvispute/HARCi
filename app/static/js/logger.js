// app/static/js/logger.js
(function () {
  function ts() {
    const d = new Date();
    return `[${d.toTimeString().slice(0, 8)}]`;
  }
  function out(level, ...args) {
    try { console[level](`${ts()} harci`, ...args); } catch { /* no-op */ }
  }

  // Build a namespaced logger; compatible with existing child() usage
  function makeLogger(ns) {
    const p = ns ? `[${ns}]` : '';
    return {
      out, ts,
      debug: (...a) => out('log',  p, ...a),
      info:  (...a) => out('log',  p, ...a),
      warn:  (...a) => out('warn', p, ...a),
      error: (...a) => out('error', p, ...a),
      event: (name, data) => out('log', p, `evt:${name}`, data ?? ''),
      child: (n) => makeLogger(ns ? `${ns}.${n}` : n)
    };
  }

  const root = makeLogger('');
  window.HARCI_LOG = root;
  root.info('[logger] ready');

  // ---- Global capture: runtime errors & unhandled promises ----
  window.addEventListener('error', (e) => {
    root.error('[window.error]', { msg: e.message, src: e.filename, line: e.lineno, col: e.colno });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason || {};
    root.error('[promise.rejection]', { name: r.name, message: r.message });
  }, true);

  // ---- Environment/Capability snapshot + autoplay probe (helps on iOS) ----
  (async () => {
    const L = root.child('cap');
    const ua = navigator.userAgent || '';
    const isIOS  = /iPad|iPhone|iPod/.test(ua);
    const safari = /^((?!chrome|android).)*safari/i.test(ua);
    const hasAC  = !!(window.AudioContext || window.webkitAudioContext);
    const tz     = Intl.DateTimeFormat().resolvedOptions().timeZone;

    L.info('[env]', { isIOS, safari, hasAudioContext: hasAC, tz });

    const autoplay = { video: null, audio: null };
    try {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true;
      await v.play(); autoplay.video = true;
    } catch { autoplay.video = false; }
    try {
      const a = document.createElement('audio');
      a.muted = true;
      await a.play(); autoplay.audio = true;
    } catch { autoplay.audio = false; }
    L.info('[autoplay.probe]', autoplay);
  })();

  // ---- Network visibility ----
  window.addEventListener('online',  () => root.info('[net] online'));
  window.addEventListener('offline', () => root.warn('[net] offline'));
})();
