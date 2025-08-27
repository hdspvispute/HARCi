// api.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('api') : console;

  // ---- small fetch helper with JSON parsing, timeout, and nice errors ----
  const DEFAULT_TIMEOUT_MS = 25_000; // keep snappy; UI will cancel sooner if needed

  function withTimeout(ms, extSignal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
    if (extSignal) {
      if (extSignal.aborted) {
        clearTimeout(timer);
        ctl.abort(extSignal.reason || new DOMException('Aborted', 'AbortError'));
      } else {
        const onAbort = () => {
          clearTimeout(timer);
          ctl.abort(extSignal.reason || new DOMException('Aborted', 'AbortError'));
          extSignal.removeEventListener('abort', onAbort);
        };
        extSignal.addEventListener('abort', onAbort);
      }
    }
    return { signal: ctl.signal, cancelTimer: () => clearTimeout(timer) };
  }

  async function j(url, { signal, timeout = DEFAULT_TIMEOUT_MS, headers, ...opts } = {}) {
    const { signal: mergedSignal, cancelTimer } = withTimeout(timeout, signal);
    try {
      const r = await fetch(url, { ...opts, signal: mergedSignal, headers });
      const txt = await r.text();
      if (!r.ok) {
        let msg = txt;
        try { msg = (JSON.parse(txt).error) || (JSON.parse(txt).message) || msg; } catch {}
        const e = new Error(`${url} ${r.status}: ${msg}`);
        e.status = r.status; e.body = txt;
        throw e;
      }
      try { return JSON.parse(txt); } catch { return txt; }
    } finally {
      cancelTimer();
    }
  }

  // tiny in-memory memo for config (never changes per page load)
  let _cfg;
  async function config() {
    if (_cfg) return _cfg;
    _cfg = await j('/api/config', { timeout: 10_000 });
    return _cfg;
  }

  const API = {
    config,
    async register(fd, opts) {
      return j('/api/register', { method: 'POST', body: fd, ...(opts || {}) });
    },
    async sessionEnd(sid, opts) {
      return j('/api/session/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid }),
        ...(opts || {})
      });
    },
    async speechToken(opts) { return j('/speech-token', opts); },
    async relayToken(opts)  { return j('/relay-token', opts); },

    // IMPORTANT: carries AbortController.signal through so UI can preempt instantly
    async assistRun(text, session_id, opts = {}) {
      return j('/assist/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, session_id }),
        ...opts
      });
    }
  };

  window.API = API;
})();
