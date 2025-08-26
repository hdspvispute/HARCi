// logger.js
(function () {
  function ts() {
    const d = new Date();
    return `[${d.toTimeString().slice(0, 8)}]`;
  }
  function out(level, ...args) {
    console[level](`${ts()} harci`, ...args);
  }
  const root = {
    out, ts,
    debug: (...a) => out('log', ...a),
    info:  (...a) => out('log', ...a),
    warn:  (...a) => out('warn', ...a),
    error: (...a) => out('error', ...a),
    child(name) {
      return {
        debug: (...a) => out('log', `[${name}]`, ...a),
        info:  (...a) => out('log', `[${name}]`, ...a),
        warn:  (...a) => out('warn', `[${name}]`, ...a),
        error: (...a) => out('error', `[${name}]`, ...a),
        child: (n) => root.child(`${name} ${n}`)
      };
    }
  };
  window.HARCI_LOG = root;
  root.info('[logger] ready');
})();
