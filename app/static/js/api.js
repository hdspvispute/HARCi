// app/static/js/api.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('api') : console;

  // --- helpers ---------------------------------------------------------------
  async function j(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { const o = JSON.parse(text); msg = o.error || o.message || JSON.stringify(o); } catch {}
      const e = new Error(`${url} ${r.status}: ${msg}`);
      e.status = r.status; e.body = text;
      throw e;
    }
    try { return JSON.parse(text); } catch { return text; }
  }

  function getSid() {
    try {
      return document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
    } catch { return ""; }
  }

  // Normalize speech token response so stt.js can cache it (expects expiresAt seconds)
  function normalizeSpeechToken(o) {
    if (!o || typeof o !== 'object') return o;
    const nowSec = Math.floor(Date.now() / 1000);
    const exp =
      Number(o.expiresAt) ||
      Number(o.exp) ||
      (o.ttl ? nowSec + Number(o.ttl) : 0) ||
      (o.token ? nowSec + 540 : 0); // fallback ~9min if server didn't send one
    return {
      token:  o.token || o.access_token || o.value || "",
      region: o.region || o.location || "eastus",
      expiresAt: exp
    };
  }

  // Optional tiny retry for transient fetch/server blips
  async function withRetry(fn, attempts = 2) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) {
        lastErr = e;
        if (!e.status || (e.status >= 500 && e.status < 600)) continue; // retry network/5xx
        break;
      }
    }
    throw lastErr;
  }

  // --- public API ------------------------------------------------------------
  const API = {
    async config() { return withRetry(() => j('/api/config')); },
    async register(fd) { return j('/api/register', { method: 'POST', body: fd }); },
    async sessionStart(sid = getSid()) {
      return j('/api/session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid })
      });
    },
    async sessionEnd(sid = getSid()) {
      // keepalive so it still posts during navigation away
      return j('/api/session/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid }),
        keepalive: true
      });
    },
    async speechToken() {
      const raw = await withRetry(() => j('/speech-token'));
      const norm = normalizeSpeechToken(raw);
      if (!norm?.token) LOG.warn('[api] speech-token missing token field', raw);
      return norm;
    },
    async relayToken() {
      // Shape varies by backend; pass through and let avatar_rtc.js handle it.
      return withRetry(() => j('/relay-token'));
    },
    // Core turns
    async assistRun(text, session_id = getSid(), { signal } = {}) {
      return j('/assist/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, session_id }),
        signal
      });
    },
    // Welcome turn (server builds the personalized prompt)
    async assistWelcome(session_id = getSid(), { signal } = {}) {
      return j('/assist/welcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id }),
        signal
      });
    }
  };

  window.API = API;
})();
