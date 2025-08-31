// app/static/js/ui_bindings.js
(() => {
  'use strict';

  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- UI helpers ------------------------------------------------------------
  window.UI = window.UI || {};

  // Visual state helpers (toggle body classes to drive CSS dimming)
  function setVisualState(state /* 'inactive' | 'busy' | 'ready' */) {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('ui-inactive', state === 'inactive');
    b.classList.toggle('ui-busy',     state === 'busy');
    b.classList.toggle('ui-ready',    state === 'ready');
  }

  // Mic warmup via STT (keeps a hidden stream alive)
  async function primeMic() {
    try { await window.HARCI_STT?.warmup?.(); } catch (e) {
      LOG.warn('[ui] stt warmup failed', e);
    }
  }

  // Central enable/disable helpers
  function getAskInput(){ return $('#txtAsk') || $('#txtAskDesk'); }
  function getAskBtn(){ return $('#btnAsk') || $('#btnAskDesk'); }

  function setChipsEnabled(on){
    $$('#quickChips [data-prompt], #quickChipsDesk [data-prompt]').forEach(c => c.disabled = !on);
  }
  function setTypedEnabled(on){
    const i = getAskInput(), b = getAskBtn();
    if (i) i.disabled = !on;
    if (b) b.disabled = !on;
  }
  function setAllEnabled(on){
    setChipsEnabled(on);
    UI.setMicEnabled(on);
    setTypedEnabled(on);
  }

  // Auto-lock controls while busy (Thinking/Starting/Processing/Preparing/Ending)
  UI.setStatus = UI.setStatus || (s => {
    UI.status = s;
    try {
      const el  = document.getElementById('statusText') || document.getElementById('status');
      const dot = document.getElementById('statusDot');
      if (el)  el.textContent = s;
      if (dot) {
        if (/Listening/i.test(s)) dot.style.background = 'var(--brand-red)';
        else if (/Thinking|Starting|Processing|Preparing|Ending/i.test(s)) dot.style.background = '#F59E0B';
        else dot.style.background = '#10B981';
      }

      // Only auto-toggle when a session is active
      if (window.__harci_sessionActive) {
        const isBusy = /Thinking|Starting|Processing|Preparing|Ending/i.test(s);
        if (isBusy) {
          setAllEnabled(false);
          setVisualState('busy');
        } else if (/Ready/i.test(s)) {
          setAllEnabled(true);
          setVisualState('ready');
        }
        // NOTE: Speaking/Listening do NOT auto-toggle; we control explicitly.
      }
    } catch {}
  });

  UI.setMicEnabled = UI.setMicEnabled || (on => {
    try { const b = document.getElementById('btnHoldMic'); if (b) b.disabled = !on; } catch {}
  });

  // ---- Audio helpers ---------------------------------------------------------
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
  async function waitForAvatar(ms = 2000) {
    const start = Date.now();
    while (!window.HARCI_AVATAR && Date.now() - start < ms) {
      await new Promise(r => setTimeout(r, 50));
    }
    return !!window.HARCI_AVATAR;
  }
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

  // Hard-mute/unmute avatar output
  function muteAvatarOutput(on) {
    try {
      if (typeof window.HARCI_AVATAR?.setOutputMuted === 'function') {
        window.HARCI_AVATAR.setOutputMuted(on);
        return;
      }
      const a = document.getElementById('remoteAudio');
      const v = document.getElementById('remoteVideo') || document.getElementById('avatarVideo');
      if (a) a.muted = on;
      if (v) v.muted = on;
    } catch {}
  }

  // ---- Sanitize markdown-lite ------------------------------------------------
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

  // ---- Config ---------------------------------------------------------------
  window.bootstrapConfig = async () => {
    if (window.HARCI_CONFIG) return window.HARCI_CONFIG;
    try { window.HARCI_CONFIG = await window.API.config(); }
    catch (e) { LOG.error('[ui] config error', e); window.HARCI_CONFIG = {}; }
    return window.HARCI_CONFIG;
  };

  // ---- Renderer --------------------------------------------------------------
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

  // ---- ask() ----------------------------------------------------------------
  window.ask = async (text) => {
    const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
    return window.API.assistRun(text, sid);
  };

  // ---- Flow gating -----------------------------------------------------------
  let turnSeq = 0;
  let inflight = null;
  let sessionActive = false;

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

  // ---- Transition ------------------------------------------------------------
  function onTransitionPage() {
    const btn = $('#btnUnlock');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await window.bootstrapConfig();
        if (await waitForAvatar(500)) {
          try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch {}
        } else {
          await softAudioUnlock();
        }
      } catch {}
      location.href = '/guide';
    }, { once: true });
  }

  // ---- Register --------------------------------------------------------------
  async function onRegisterPage(){
    const f = $('#regForm');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        const r = await window.API.register(fd);
        if (r?.next) location.href = r.next; else location.href = '/transition';
      } catch (e) {
        LOG.error('[ui] register error', e);
        const er = $('#regError');
        if (er){ er.textContent = 'Please fill in required fields.'; er.classList.remove('hidden'); }
      }
    });
  }

  // ---- Guide ----------------------------------------------------------------
  async function onGuidePage(){
    await window.bootstrapConfig();

    const audio      = $('#remoteAudio');
    const sessionBtn = $('#btnSessionToggle') || $('#btnStartSession');
    const holdBtn    = $('#btnHoldMic'); // << single declaration

    UI.setStatus('Tap start');

    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false; audio.volume = 1.0; audio.playsInline = true;
        if (!audio.srcObject) audio.srcObject = new MediaStream();
        audio.play?.().catch(()=>{});
      } catch {}
    }

    // Ensure mic is visible even when disabled pre-session
    if (holdBtn) {
      holdBtn.classList.remove('hidden');
      holdBtn.style.visibility = 'visible';
      holdBtn.style.opacity = '';
    }

    // Pre-session: visible but disabled + visual state
    setAllEnabled(false);
    setVisualState('inactive');

    let welcomed = false;

    async function runAgentWelcome() {
      if (welcomed) return;
      welcomed = true;

      // Allow interaction during welcome
      UI.setStatus('Thinking…');
      const welcomeAC = new AbortController();
      try {
        let res = null;
        if (typeof window.API.assistWelcome === 'function') {
          res = await window.API.assistWelcome(undefined, { signal: welcomeAC.signal });
        } else {
          res = await window.API.assistRun('Welcome me', undefined, { signal: welcomeAC.signal });
        }
        if (res) {
          applyResponse(res);
          if (res.narration) { await speakNow(res.narration, { turn: 'welcome' }); }
        }
        UI.setStatus('Ready');
      } catch (err) {
        await speakNow('Welcome! I’m HARCi. Ask me about the agenda, venue map, or speakers — or press and hold the mic to talk.');
        UI.setStatus('Ready');
      }
    }

    async function startSessionFlow(){
      if (sessionBtn) sessionBtn.disabled = true;
      UI.setStatus('Starting…');
      setVisualState('busy');

      if (await waitForAvatar(800)) {
        try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch { await softAudioUnlock(); }
      } else {
        await softAudioUnlock();
      }
      primeAudioEl();

      await primeMic();

      if (!await waitForAvatar(3000)) {
        LOG.warn('[ui] avatar not ready yet; continuing (startSession will retry internally)');
      }
      await window.HARCI_AVATAR.startSession();

      sessionActive = true;
      window.__harci_sessionActive = true;

      setAllEnabled(true);
      setVisualState('ready');

      if (sessionBtn) { sessionBtn.textContent = 'End session'; sessionBtn.disabled = false; }

      runAgentWelcome().catch(e => LOG.warn('[ui] welcome failed', e));
    }

    async function endSessionFlow(){
      if (sessionBtn) sessionBtn.disabled = true;
      UI.setStatus('Ending…');
      setVisualState('busy');
      cancelPending('end');

      try { await window.HARCI_STT?.dispose?.(); } catch {}

      try {
        const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
        await window.API.sessionEnd(sid);
      } catch {}

      setAllEnabled(false);
      setVisualState('inactive');

      window.__harci_sessionActive = false;
      sessionActive = false;

      if (sessionBtn) { sessionBtn.textContent = 'Start session'; sessionBtn.disabled = false; }
      location.href = '/ended';
    }

    sessionBtn?.addEventListener('click', async () => {
      try {
        if (!sessionActive) await startSessionFlow();
        else await endSessionFlow();
      } catch (e) {
        LOG.error('[ui] session toggle error', e);
        UI.setStatus('Retrying…');
        if (sessionBtn) sessionBtn.disabled = false;
      }
    });

    // ---- Prompt runner (chips / typed / mic) ---------------------------------
    async function runPrompt(p){
      if (!sessionActive) { UI.setStatus('Start session to interact'); return; }

      const myTurn = ++turnSeq;
      cancelPending('chip');

      // Busy (Thinking): lock everything + grey UI
      setAllEnabled(false);
      setVisualState('busy');
      UI.setStatus('Thinking…');

      const brief = $('#briefing'); if (brief) brief.innerHTML = '';

      const ac = new AbortController(); inflight = ac;
      const TIMEOUT_MS = 25_000;
      const timeoutId = setTimeout(() => { try { ac.abort(); } catch {} }, TIMEOUT_MS);

      let res = null;
      try {
        res = await window.API.assistRun(p, undefined, { signal: ac.signal });
      } catch (e) {
        if (e.name !== 'AbortError') UI.setStatus('Error');
        setAllEnabled(true);
        setVisualState('ready');
        return;
      } finally {
        clearTimeout(timeoutId);
        inflight = null;
      }

      if (myTurn !== turnSeq || !res) {
        setAllEnabled(true);
        setVisualState('ready');
        return;
      }

      // Got reply — show it and IMMEDIATELY re-enable (let user barge-in)
      applyResponse(res);
      UI.setStatus('Speaking…');  // not treated as busy in setStatus
      setAllEnabled(true);
      setVisualState('ready');

      try {
        await speakNow(res.narration || 'Here is the information.', { turn: myTurn });
      } finally {
        if (myTurn === turnSeq) UI.setStatus('Ready');
      }
    }

    // Chips (mobile + desktop)
    const chips = $$('#quickChips [data-prompt], #quickChipsDesk [data-prompt]');
    chips.forEach(btn => btn.addEventListener('click', ()=> {
      if (!sessionActive) { UI.setStatus('Start session to interact'); return; }
      runPrompt(btn.dataset.prompt);
    }));

    // ---- Mic press & hold (robust) ------------------------------------------
    let isHolding = false;
    let holdToken = 0;

    if (window.HARCI_STT && typeof window.HARCI_STT.on === 'function') {
      window.HARCI_STT.on('partial', ({ text }) => {
        if (!isHolding) return;
        const i = getAskInput(); if (i) i.value = text || '…';
      });
      window.HARCI_STT.on('final', ({ text }) => {
        if (!isHolding) return;
        const i = getAskInput(); if (i) i.value = text || '';
      });
    }

    if (holdBtn) {
      try { holdBtn.setAttribute('type', 'button'); } catch {}
      holdBtn.classList.add('select-none', 'touch-none');
      try { holdBtn.style.webkitTapHighlightColor = 'transparent'; } catch {}
      ['contextmenu','dragstart','selectstart','gesturestart'].forEach(evt =>
        holdBtn.addEventListener(evt, (e) => e.preventDefault(), { passive: false })
      );
    }

    const press = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!sessionActive) { UI.setStatus('Start session to talk'); return; }
      if (isHolding) return;
      isHolding = true;
      holdToken++;

      cancelPending('ptt');
      try { await (window.HARCI_AVATAR?.ensureAudioUnlocked?.() ?? softAudioUnlock()); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const i = getAskInput(); if (i) i.value = 'Listening…';

      // Hard-mute avatar while listening to avoid bleed
      muteAvatarOutput(true);

      UI.setStatus('Listening'); UI.setMicEnabled(false);
      try {
        try { holdBtn?.setPointerCapture?.(e.pointerId); } catch {}
        await window.HARCI_STT.beginHold();
        holdBtn?.classList.add('ring-2','ring-white/50');
      } catch (err) {
        LOG.warn('[ui] beginHold failed', err);
        isHolding = false;
        muteAvatarOutput(false);
        try { holdBtn?.releasePointerCapture?.(e.pointerId); } catch {}
        UI.setStatus('Ready'); UI.setMicEnabled(true);
      }
    };

    const release = async (e) => {
      e?.preventDefault?.(); e?.stopPropagation?.();
      if (!isHolding) return;
      const myToken = holdToken;
      isHolding = false;

      try { holdBtn?.releasePointerCapture?.(e?.pointerId); } catch {}
      holdBtn?.classList.remove('ring-2','ring-white/50');
      try { window.EARCON?.stop?.(); } catch {}

      let text = '';
      try {
        const r = await window.HARCI_STT.endHold();
        text = (r && r.text) || '';
      } catch (err) {
        LOG.warn('[ui] endHold failed', err);
      } finally {
        muteAvatarOutput(false);
      }

      if (myToken !== holdToken) return;

      if (!text) {
        const i = getAskInput(); if (i) i.value = '';
        UI.setStatus('Ready'); UI.setMicEnabled(true);
        return;
      }

      const i = getAskInput(); if (i) i.value = text;
      UI.setStatus('Processing…'); // runPrompt will flip busy/ready classes
      await runPrompt(text);
    };

    if (holdBtn) {
      holdBtn.addEventListener('pointerdown', press, { passive: false });
      holdBtn.addEventListener('pointerup',   release, { passive: false });
      holdBtn.addEventListener('pointercancel', release, { passive: false });
      holdBtn.addEventListener('pointerleave',  release, { passive: false });

      // Safety: if pointer released off the button, still stop
      window.addEventListener('pointerup', release, { passive: false });

      // Optional tap-to-toggle fallback on coarse pointers
      if (window.matchMedia?.('(pointer: coarse)').matches) {
        let toggled = false;
        holdBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          toggled ? release(e) : press(e);
          toggled = !toggled;
        }, { passive: false });
      }
    }

    // Keyboard accessibility for mic (guarded)
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        if (!sessionActive) { UI.setStatus('Start session to talk'); return; }
        if (!e.repeat) $('#btnHoldMic')?.dispatchEvent(new PointerEvent('pointerdown'));
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        $('#btnHoldMic')?.dispatchEvent(new PointerEvent('pointerup'));
        e.preventDefault();
      }
    });

    // Typed questions (mobile + desktop forms)
    ['#askForm', '#askFormDesk'].forEach(sel => {
      const form = $(sel);
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!sessionActive) { UI.setStatus('Start session to ask'); return; }
        const input = getAskInput();
        const text = (input?.value || '').trim();
        if (!text) return;
        input.value = '';
        await runPrompt(text);
      });
    });
  }

  // ---- Route by presence -----------------------------------------------------
  if (document.getElementById('regForm')) onRegisterPage();
  if (document.getElementById('unlockCard') || document.getElementById('btnUnlock')) onTransitionPage();
  if (document.getElementById('remoteVideo')) onGuidePage();
})();
