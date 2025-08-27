(() => {
  'use strict';
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // --- UI helpers (idempotent) ------------------------------------------------
  window.UI = window.UI || {};
  UI.setStatus = UI.setStatus || (s => {
    UI.status = s;
    try {
      const el = document.getElementById('statusText') || document.getElementById('status');
      if (el) el.textContent = s;
    } catch {}
  });
  UI.setMicEnabled = UI.setMicEnabled || (on => {
    try { const b = document.getElementById('btnHoldMic'); if (b) b.disabled = !on; } catch {}
  });

  // Legacy global shim so older files don’t crash
  window.setStatus = window.setStatus || (s => UI.setStatus(s));

  // --- Speech helper (works with or without lifecycle patch) ------------------
  function estimateMs(text) {
    const t = (text || '').trim();
    if (!t) return 1200;
    const w = t.split(/\s+/).length;
    return Math.min(25_000, Math.max(1200, Math.round((w / 2.5) * 1000))); // ~2.5 wps
  }
  function speakNow(text, opts) {
    if (window.speakSafe) return window.speakSafe(text, opts);

    UI.setStatus('Speaking…');
    let done = () => UI.setStatus('Ready');
    try {
      const maybe = window.HARCI_AVATAR?.speak?.(text);
      const timer = setTimeout(() => { try { done(); } catch {} }, estimateMs(text) + 1500);
      if (maybe && typeof maybe.then === 'function') {
        return maybe.finally(() => { clearTimeout(timer); done(); });
      }
      return Promise.resolve();
    } catch {
      done();
      return Promise.resolve();
    }
  }

  // --- sanitize markdown-lite -------------------------------------------------
  function sanitize(md){
    let s = String(md || '');
    s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    s = s.replace(/^### (.*)$/gm, '<h3 class="font-semibold mt-2 mb-1">$1</h3>');
    s = s.replace(/^## (.*)$/gm,  '<h2 class="font-semibold text-lg mt-2 mb-1">$1</h2>');
    s = s.replace(/^# (.*)$/gm,   '<h1 class="font-bold text-xl mt-2 mb-1">$1</h1>');
    s = s.replace(/^(?:-|\*) (.*)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>)(\s*(?!<li>))/gs, '<ul class="list-disc ml-6">$1</ul>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
    return s;
  }

  // --- Config bootstrap -------------------------------------------------------
  window.bootstrapConfig = async () => {
    if (window.HARCI_CONFIG) return window.HARCI_CONFIG;
    try { window.HARCI_CONFIG = await window.API.config(); }
    catch (e) { LOG.error('[ui] config error', e); window.HARCI_CONFIG = {}; }
    return window.HARCI_CONFIG;
  };

  // --- Small renderer ---------------------------------------------------------
  function applyResponse(res){
    const brief = $('#briefing');
    const imgP  = $('#imagePanel');
    const img   = $('#briefImage');
    const alt   = $('#imgAlt');
    const md = (res && (res.briefing_md || res.briefing || '')) || '';
    if (brief) brief.innerHTML = sanitize(md);
    const im = res?.image;
    if (im && im.url && imgP && img) {
      img.src = im.url; img.alt = im.alt || '';
      if (alt) alt.textContent = im.alt || '';
      imgP.classList.remove('hidden');
    } else {
      imgP?.classList.add('hidden');
    }
  }

  // --- Minimal ask() helper with session cookie -------------------------------
  window.ask = async (text) => {
    const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
    return window.API.assistRun(text, sid);
  };

  // --- Flow control: only-latest + cancellation -------------------------------
  let turnSeq = 0;           // increases per user action
  let inflight = null;       // AbortController for /assist/run

  function cancelPending(reason = 'user-preempt') {
    try { if (inflight) inflight.abort(); } catch {}
    inflight = null;
    try {
      if (typeof window.HARCI_AVATAR?.stopSpeaking === 'function') {
        window.HARCI_AVATAR.stopSpeaking();
      } else {
        window.HARCI_SPEECH?.stop?.(reason);
      }
    } catch {}
  }

  // --- Transition page --------------------------------------------------------
  function onTransitionPage() {
    const btn = $('#btnUnlock');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await window.bootstrapConfig();
        await window.HARCI_AVATAR?.ensureAudioUnlocked?.();
      } catch {}
      location.href = '/guide';
    }, { once: true });
  }

  // --- Register page ----------------------------------------------------------
  async function onRegisterPage(){
    const f = $('#regForm');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        const r = await API.register(fd);
        if (r?.next) location.href = r.next; else location.href = '/transition';
      } catch (e) {
        LOG.error('[ui] register error', e);
        const er = $('#regError');
        if (er){ er.textContent = 'Please fill in required fields.'; er.classList.remove('hidden'); }
      }
    });
  }

  // --- Guide page -------------------------------------------------------------
  async function onGuidePage(){
    await window.bootstrapConfig();

    const video = $('#remoteVideo');
    const audio = $('#remoteAudio');
    LOG.info('[ui] guide: video/audio elements', { video: !!video, audio: !!audio });
    UI.setStatus('Tap start');

    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false; audio.volume = 1.0; audio.playsInline = true;
        if (!audio.srcObject) audio.srcObject = new MediaStream();
        audio.play?.().catch(()=>{});
      } catch {}
    }

    const startBtn = $('#btnStartSession') || document.body;
    startBtn.addEventListener('click', async () => {
      try {
        UI.setStatus('Starting…');
        await window.HARCI_AVATAR.ensureAudioUnlocked();
        primeAudioEl();

        await window.HARCI_AVATAR.startSession();
        UI.setStatus('Ready');

        // Welcome (non-blocking)
        speakNow('Welcome to the event! I am your HARCi avatar guide. I can answer questions about the agenda, venue, speakers, and help you navigate the event. Just tap a quick chip or hold the mic to talk to me.');
      } catch (e) {
        LOG.error('[ui] avatar start error', e);
        UI.setStatus('Retrying…');
      }
    }, { once: true });

    // Quick chips --------------------------------------------------------------
    const chips = $$('#quickChips [data-prompt]');

    // ui_bindings.js  (inside onGuidePage -> runPrompt)
    async function runPrompt(p) {
      const myTurn = ++turnSeq;
      cancelPending('chip');                      // stop speech / abort previous
      chips.forEach(c => c.disabled = true);
      UI.setMicEnabled(false);

      // Clear UI first
      const cap = $('#caption'); if (cap) cap.textContent = '';
      const brief = $('#briefing'); if (brief) brief.innerHTML = '';

      // Make sure status shows now and isn't overridden by any late stop()
      UI.setStatus('Thinking…');

      const ac = new AbortController(); inflight = ac;
      let res = null;
      try {
        res = await window.API.assistRun(p, undefined, { signal: ac.signal });
      } catch (e) {
        if (e.name !== 'AbortError') { LOG.error('[ui] chip error', e); UI.setStatus('Error'); }
        chips.forEach(c => c.disabled = false); UI.setMicEnabled(true);
        return;
      } finally {
        inflight = null;
      }

      if (myTurn !== turnSeq || !res) { chips.forEach(c=> c.disabled = false); UI.setMicEnabled(true); return; }

      applyResponse(res);
      // speakNow will flip to “Speaking…” (then back to Ready) automatically
      speakNow(res.narration || 'Here is the information.', { turn: myTurn });

      chips.forEach(c=> c.disabled = false); UI.setMicEnabled(true);
    }

    chips.forEach(btn => btn.addEventListener('click', ()=> runPrompt(btn.dataset.prompt)));

    // Mic press & hold — single event system with strict guards ----------------
    const hold = $('#btnHoldMic');
    let isHolding = false;
    let activePointerId = null;

    if (window.HARCI_STT && typeof window.HARCI_STT.on === 'function') {
      window.HARCI_STT.on('partial', ({ text }) => {
        if (!isHolding) return;
        const cap = $('#caption'); if (cap) cap.textContent = text || '…';
      });
      window.HARCI_STT.on('final', ({ text }) => {
        if (!isHolding) return;
        const cap = $('#caption'); if (cap) cap.textContent = text || '';
      });
    }

    const press = async (e) => {
      e.preventDefault();
      if (isHolding) return;                      // guard re-entry
      isHolding = true;
      activePointerId = e.pointerId ?? 'mouse';

      try { hold?.setPointerCapture?.(e.pointerId); } catch {}
      cancelPending('ptt');
      try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const cap = $('#caption'); if (cap) cap.textContent = 'Listening…';

      UI.setStatus('Listening'); UI.setMicEnabled(false);
      try { await window.HARCI_STT.beginHold(); hold?.classList.add('ring-2','ring-white/50'); }
      catch (err) { LOG.warn('[ui] beginHold failed', err); isHolding = false; activePointerId = null; UI.setStatus('Ready'); UI.setMicEnabled(true); }
    };

    const release = async (e) => {
      e.preventDefault();
      // Only the pointer that started can end it
      if (!isHolding) return;
      if (activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) return;

      hold?.classList.remove('ring-2','ring-white/50');
      try { hold?.releasePointerCapture?.(e.pointerId); } catch {}
      try { window.EARCON?.stop?.(); } catch {}

      // Flip flags BEFORE async to avoid double-calls on fast sequences
      isHolding = false;
      activePointerId = null;

      const { text } = await window.HARCI_STT.endHold();
      UI.setStatus('Processing…');

      if (!text) { const cap = $('#caption'); if (cap) cap.textContent = ''; UI.setStatus('Ready'); UI.setMicEnabled(true); return; }

      const cap = $('#caption'); if (cap) cap.textContent = text;
      const askInput = $('#askInput'); if (askInput) { askInput.removeAttribute('disabled'); askInput.removeAttribute('readonly'); }
      await runPrompt(text);
      UI.setStatus('Ready'); UI.setMicEnabled(true);
    };

    const supportsPointer = 'onpointerdown' in window;
    if (hold) {
      if (supportsPointer) {
        hold.addEventListener('pointerdown', press, { passive:false });
        hold.addEventListener('pointerup', release);
        hold.addEventListener('pointercancel', release);
        hold.addEventListener('pointerleave', release);
      } else {
        // Fallback for very old browsers
        hold.addEventListener('touchstart', (e) => press({ ...e, pointerId: 1, preventDefault: () => e.preventDefault() }), { passive:false });
        hold.addEventListener('touchend',   (e) => release({ ...e, pointerId: 1, preventDefault: () => e.preventDefault() }));
      }
    }

    // End session --------------------------------------------------------------
    $('#btnEnd')?.addEventListener('click', async ()=> {
      try {
        const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
        await API.sessionEnd(sid);
      } catch {}
      location.href = '/ended';
    });
  }

  // --- Route by presence of elements -----------------------------------------
  if (document.getElementById('regForm')) onRegisterPage();
  if (document.getElementById('unlockCard') || document.getElementById('btnUnlock')) onTransitionPage();
  if (document.getElementById('remoteVideo')) onGuidePage();

  LOG.info('[ui] wired', window.HARCI_CONFIG || {});
})();
