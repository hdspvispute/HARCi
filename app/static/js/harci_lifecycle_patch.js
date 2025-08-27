// /static/js/harci_lifecycle_patch.js
// HARCi Lifecycle Patch (drop-in): adds robust "Speaking" start/finish + timeouts + ctrl-channel hooks.
// Does NOT change your existing start/speak wiring; it only wraps it safely.

(function () {
  const g = window;
  if (!g) return;

  // --- UI shims (no-op if you already have these) ---
  g.UI = g.UI || {};
  g.UI.setStatus = g.UI.setStatus || (s => { g.UI.status = s; try {
    const el = document.getElementById('statusText'); if (el) el.textContent = s;
  } catch {}});
  g.UI.setMicEnabled = g.UI.setMicEnabled || (on => {
    try { const b = document.getElementById('btnHoldMic'); if (b) b.disabled = !on; } catch {}
  });

  // --- Speaking lifecycle state ---
  const L = {
    speaking: false,
    timer: null,
    resolve: null,
    pc: null,
    ctrl: null,       // DataChannel (if provided by service)
    audioEl: null,
    videoEl: null
  };

  function estimateSpeechMs(text) {
    const t = (text || '').trim();
    if (!t) return 1200;
    const chars = t.length;
    const sentences = (t.match(/[.!?]/g) || []).length;
    const base = Math.max(1800, Math.ceil(chars / 12) * 1000);
    return base + sentences * 600 + 400;
  }

  function finish(source) {
    if (!L.speaking) return;
    L.speaking = false;
    clearTimeout(L.timer); L.timer = null;
    try { g.UI.setStatus('Idle'); } catch {}
    try { g.UI.setMicEnabled(true); } catch {}
    if (typeof L.resolve === 'function') { const r = L.resolve; L.resolve = null; try { r(); } catch {} }
    console.info('[HARCi] speaking finished via', source || 'unknown');
  }

  function start(text) {
    L.speaking = true;
    clearTimeout(L.timer);
    try { g.UI.setStatus('Speaking'); } catch {}
    try { g.UI.setMicEnabled(false); } catch {}
    L.timer = setTimeout(() => finish('timeout'), estimateSpeechMs(text));
  }

  function attachOnTrack(pc, audioEl, videoEl) {
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (e.track.kind === 'audio' && audioEl) {
        audioEl.srcObject = stream;
        e.track.onended = () => finish('track-ended');
      }
      if (e.track.kind === 'video' && videoEl) {
        videoEl.srcObject = stream;
      }
    };
  }

  function attachControl(pc) {
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      if (!ch) return;
      if (['avatar', 'avatar-control', 'control'].includes(ch.label)) {
        L.ctrl = ch;
        ch.onmessage = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { msg = { type: String(ev.data || '') }; }
          const t = String(msg.type || msg.event || '').toLowerCase();
          // Cover common variants from services
          if (['turn.end','speak.completed','synthesiscompleted','avatar.speak.done','tts.end','audio.end'].includes(t)) {
            finish('ctrl');
          }
        };
        ch.onclose = () => finish('ctrl-close');
        ch.onerror = () => finish('ctrl-error');
      }
    };
  }

  function stop(reason = 'user') {
    try { L.ctrl?.send(JSON.stringify({ type: 'stop' })); } catch {}
    finish(reason);
  }

  // Expose lightweight API for other scripts (optional)
  g.HARCI_SPEECH = g.HARCI_SPEECH || {
    get speaking() { return L.speaking; },
    finish, stop,
  };

  // --- Non-invasive wrapper around HARCI_AVATAR if it exists ---
  const AV = g.HARCI_AVATAR;
  if (!AV) {
    console.warn('[HARCi] lifecycle patch: HARCI_AVATAR not found at load time (ok if loaded later).');
    return;
  }

  // Wrap start() to attach track/control hooks
  if (!AV.__wrapped_start && typeof AV.start === 'function') {
    const origStart = AV.start.bind(AV);
    AV.start = async function (videoEl, audioEl, ...rest) {
      const pc = await origStart(videoEl, audioEl, ...rest);
      L.pc = pc; L.audioEl = audioEl || L.audioEl; L.videoEl = videoEl || L.videoEl;
      try { attachOnTrack(pc, L.audioEl, L.videoEl); } catch {}
      try { attachControl(pc); } catch {}
      return pc;
    };
    AV.__wrapped_start = true;
  }

  // Wrap speak() so it ALWAYS resolves (via completion event or timeout)
  if (!AV.__wrapped_speak && typeof AV.speak === 'function') {
    const origSpeak = AV.speak.bind(AV);
    AV.speak = async function (text, opts) {
      const t = (text || '').trim();
      if (!t) { finish('empty'); return; }
      if (L.speaking) { stop('preempt'); }
      start(t);
      try {
        // fire-and-forget your original speak; resolution is handled by completion/timeout
        origSpeak(t, opts).catch(e => { console.warn('[HARCi] speak send failed', e); finish('send-error'); });
      } catch (e) {
        console.warn('[HARCi] speak threw', e); finish('send-throw');
      }
      return new Promise(res => { L.resolve = res; });
    };
    AV.__wrapped_speak = true;
  }

  // Optional: expose stop on AV
  if (typeof AV.stop !== 'function') {
    AV.stop = () => stop('api');
  }

  console.info('[HARCi] lifecycle patch installed.');
})();
