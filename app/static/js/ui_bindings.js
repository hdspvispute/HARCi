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

  // Legacy shim
  window.setStatus = window.setStatus || (s => UI.setStatus(s));

  // --- Soft WebAudio unlock (fallback when avatar module not ready) -----------
  async function softAudioUnlock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      LOG.info('[ui] soft audio unlocked');
    } catch (e) {
      LOG.warn('[ui] soft audio unlock failed', e);
    }
  }

  // --- Wait until avatar is available (or time out) ---------------------------
  async function waitForAvatar(ms = 2000) {
    const start = Date.now();
    while (!window.HARCI_AVATAR && Date.now() - start < ms) {
      await new Promise(r => setTimeout(r, 50));
    }
    return !!window.HARCI_AVATAR;
  }

  // --- Speech helper (works with or without lifecycle patch) ------------------
  function estimateMs(text) {
    const t = (text || '').trim();
    if (!t) return 1200;
    const w = t.split(/\s+/).length;
    return Math.min(25_000, Math.max(1200, Math.round((w / 2.5) * 1000)));
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

  // --- ask() ------------------------------------------------------------------
  window.ask = async (text) => {
    const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
    return window.API.assistRun(text, sid);
  };

  // --- Flow control: only-latest + cancellation -------------------------------
  let turnSeq = 0;
  let inflight = null;

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
        // Prefer avatar unlock if available; otherwise fallback
        if (await waitForAvatar(500)) {
          try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch {}
        } else {
          await softAudioUnlock();
        }
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

        // Ensure an audio unlock before creating/starting WebRTC
        if (await waitForAvatar(800)) {
          try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch { await softAudioUnlock(); }
        } else {
          await softAudioUnlock();
        }
        primeAudioEl();

        // Wait again, then start the avatar
        if (!await waitForAvatar(1500)) {
          throw new Error('Avatar runtime not ready');
        }
        await window.HARCI_AVATAR.startSession();
        UI.setStatus('Ready');

        speakNow('Welcome to the event! I am your HARCi avatar guide. I can answer questions about the agenda, venue, speakers, and help you navigate the event. Just tap a quick chip or hold the mic to talk to me.');
      } catch (e) {
        LOG.error('[ui] avatar start error', e);
        UI.setStatus('Retrying…');
      }
    }, { once: true });

    // Quick chips --------------------------------------------------------------
    const chips = $$('#quickChips [data-prompt]');

    async function runPrompt(p){
      const myTurn = ++turnSeq;
      cancelPending('chip');
      chips.forEach(c=> c.disabled = true);
      UI.setStatus('Thinking…'); UI.setMicEnabled(false);

      const cap = $('#caption'); if (cap) cap.textContent = '';
      const brief = $('#briefing'); if (brief) brief.innerHTML = '';

      const ac = new AbortController(); inflight = ac;
      let res = null;
      try {
        res = await window.API.assistRun(p, undefined, { signal: ac.signal });
      } catch (e) {
        if (e.name !== 'AbortError') { LOG.error('[ui] chip error', e); UI.setStatus('Error'); }
        chips.forEach(c=> c.disabled = false); UI.setMicEnabled(true);
        return;
      } finally {
        inflight = null;
      }

      if (myTurn !== turnSeq || !res) { chips.forEach(c=> c.disabled = false); UI.setMicEnabled(true); return; }

      applyResponse(res);
      speakNow(res.narration || 'Here is the information.', { turn: myTurn });

      chips.forEach(c=> c.disabled = false); UI.setMicEnabled(true);
    }
    chips.forEach(btn => btn.addEventListener('click', ()=> runPrompt(btn.dataset.prompt)));

    // Mic press & hold (pointer-only, dedup releases) --------------------------
    const hold = $('#btnHoldMic');
    let isHolding = false;
    let holdToken = 0;

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
      if (isHolding) return;
      isHolding = true;
      holdToken++;

      cancelPending('ptt');
      try { await (window.HARCI_AVATAR?.ensureAudioUnlocked?.() ?? softAudioUnlock()); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const cap = $('#caption'); if (cap) cap.textContent = 'Listening…';

      UI.setStatus('Listening'); UI.setMicEnabled(false);
      try {
        await window.HARCI_STT.beginHold();
        hold?.classList.add('ring-2','ring-white/50');
      } catch (err) {
        LOG.warn('[ui] beginHold failed', err);
        isHolding = false;
        UI.setStatus('Ready'); UI.setMicEnabled(true);
      }
    };

    const release = async (e) => {
      e.preventDefault();
      if (!isHolding) return;
      const myToken = holdToken;
      isHolding = false;

      hold?.classList.remove('ring-2','ring-white/50');
      try { window.EARCON?.stop?.(); } catch {}
      let text = '';
      try {
        const r = await window.HARCI_STT.endHold();
        text = (r && r.text) || '';
      } catch (err) {
        LOG.warn('[ui] endHold failed', err);
      }

      if (myToken !== holdToken) return;
      UI.setStatus('Processing…');

      if (!text) {
        const cap = $('#caption'); if (cap) cap.textContent = '';
        UI.setStatus('Ready'); UI.setMicEnabled(true);
        return;
      }

      const cap = $('#caption'); if (cap) cap.textContent = text;
      await runPrompt(text);
      UI.setStatus('Ready'); UI.setMicEnabled(true);
    };

    if (hold) {
      hold.addEventListener('pointerdown', press);
      hold.addEventListener('pointerup', release);
      hold.addEventListener('pointercancel', release);
      hold.addEventListener('pointerleave', release);
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
