// api.js
(function () {
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('api') : console;

  async function j(url, opts) {
    const r = await fetch(url, opts);
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { const o = JSON.parse(text); msg = o.error || JSON.stringify(o); } catch {}
      const e = new Error(`${url} ${r.status}: ${msg}`);
      e.status = r.status; e.body = text; throw e;
    }
    try { return JSON.parse(text); } catch { return text; }
  }

  const API = {
    async config() { return j('/api/config'); },
    async register(fd) {
      return j('/api/register', { method: 'POST', body: fd });
    },
    async sessionEnd(sid) {
      return j('/api/session/end', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ sid })
      });
    },
    async speechToken() { return j('/speech-token'); },
    async relayToken()  { return j('/relay-token'); },
    async assistRun(text, session_id) {
      return j('/assist/run', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ text, session_id })
      });
    }
  };

  window.API = API;
})();
