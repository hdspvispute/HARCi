// app/static/js/ui_bindings.js
(() => {
  'use strict';

  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- UI helpers ------------------------------------------------------------
  window.UI = window.UI || {};

  function setVisualState(state /* 'inactive' | 'busy' | 'ready' */) {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('ui-inactive', state === 'inactive');
    b.classList.toggle('ui-busy',     state === 'busy');
    b.classList.toggle('ui-ready',    state === 'ready');
    updateBusyBar(state);
  }

  // Slim progress bar in header
  function updateBusyBar(stateOrStatus) {
    const bar = document.getElementById('busyBar');
    if (!bar) return;
    const s = String(stateOrStatus || '').toLowerCase();
    const isBusy =
      s.includes('busy') ||
      /starting|thinking|processing|preparing|ending/.test(s);
    bar.style.width = isBusy ? '100%' : '0';
  }

  async function primeMic() {
    try { await window.HARCI_STT?.warmup?.(); } catch (e) {
      LOG.warn('[ui] stt warmup failed', e);
    }
  }

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
      updateBusyBar(s);

      if (window.__harci_sessionActive) {
        const isBusy = /Thinking|Starting|Processing|Preparing|Ending/i.test(s);
        if (isBusy) { setAllEnabled(false); setVisualState('busy'); }
        else if (/Ready/i.test(s)) { setAllEnabled(true); setVisualState('ready'); }
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
    if (brief) {
      brief.innerHTML = sanitize(md);
      // scroll the briefing container to top to reveal new content
      try { brief.closest('section.briefing-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    }
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

  // ---- Pages ----------------------------------------------------------------
  function onTransitionPage() {
    const btn = $('#btnUnlock');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await window.bootstrapConfig();
        if (await waitForAvatar(500)) {
          try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch { await softAudioUnlock(); }
        } else {
          await softAudioUnlock();
        }
      } catch {}
      location.href = '/guide';
    }, { once: true });
  }

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

  async function onGuidePage(){
    await window.bootstrapConfig();

    const audio      = $('#remoteAudio');
    const holdBtn    = $('#btnHoldMic');
    const endBtn     = $('#btnEndSession');

    // Initial status
    UI.setStatus('Starting…');
    setAllEnabled(false);
    setVisualState('busy');

    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false; audio.volume = 1.0; audio.playsInline = true;
        if (!audio.srcObject) audio.srcObject = new MediaStream();
        audio.play?.().catch(()=>{});
      } catch {}
    }

    // Ensure mic visible even if disabled during startup
    if (holdBtn) {
      holdBtn.classList.remove('hidden');
      holdBtn.style.visibility = 'visible';
      holdBtn.style.opacity = '';
    }

    // Auto-start session
    (async () => {
      try {
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

        // Optional: let backend know (fallback if API.sessionStart missing)
        try {
          const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
          if (window.API.sessionStart) {
            await window.API.sessionStart(sid);
          } else {
            await fetch('/api/session/start', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sid })
            }).catch(()=>{});
          }
        } catch {}

        // End session button appears now
        if (endBtn) { endBtn.classList.remove('hidden'); endBtn.disabled = false; }

        setAllEnabled(true);
        setVisualState('ready');
        UI.setStatus('Ready');

        // Optional welcome (keeps inputs enabled)
        try {
          const res = await window.API.assistWelcome?.();
          if (res) {
            applyResponse(res);
            if (res.narration) await speakNow(res.narration, { turn: 'welcome' });
          }
        } catch (e) {
          LOG.warn('[ui] welcome failed', e);
        }
      } catch (err) {
        LOG.error('[ui] auto-start failed', err);
        setAllEnabled(false);
        setVisualState('inactive');
        UI.setStatus('Failed to start');
      }
    })();

    // End session (header button)
    endBtn?.addEventListener('click', async () => {
      if (!sessionActive) return;
      endBtn.disabled = true;
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

      location.href = '/ended';
    });

    // ---- Prompt runner -------------------------------------------------------
    async function runPrompt(p){
      if (!sessionActive) { UI.setStatus('Starting…'); return; }

      const myTurn = ++turnSeq;
      cancelPending('chip');

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

      applyResponse(res);
      UI.setStatus('Speaking…');
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
      if (!sessionActive) { UI.setStatus('Starting…'); return; }
      runPrompt(btn.dataset.prompt);
    }));

    // ---- Mic press & hold (pure PTT) ----------------------------------------
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
      if (!sessionActive) { UI.setStatus('Starting…'); return; }
      if (isHolding) return;
      isHolding = true;
      holdToken++;

      cancelPending('ptt');
      try { await (window.HARCI_AVATAR?.ensureAudioUnlocked?.() ?? softAudioUnlock()); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const i = getAskInput(); if (i) i.value = 'Listening…';

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
      UI.setStatus('Processing…');
      await runPrompt(text);
    };

    if (holdBtn) {
      // Pointer events cover mouse, pen, and touch on iOS/Android these days
      holdBtn.addEventListener('pointerdown', press,   { passive: false });
      holdBtn.addEventListener('pointerup',   release, { passive: false });
      holdBtn.addEventListener('pointercancel', release, { passive: false });
      holdBtn.addEventListener('pointerleave',  release, { passive: false });
      window.addEventListener('pointerup', release, { passive: false });

      // No tap-to-toggle fallback; pure press-and-hold for clarity
    }

    // Keyboard mic (spacebar PTT outside inputs)
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        if (!sessionActive) { UI.setStatus('Starting…'); return; }
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

    // Typed questions
    ['#askForm', '#askFormDesk'].forEach(sel => {
      const form = $(sel);
      form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!sessionActive) { UI.setStatus('Starting…'); return; }
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
