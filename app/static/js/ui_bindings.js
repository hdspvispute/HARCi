// app/static/js/ui_bindings.js
(() => {
  'use strict';

  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- UI helpers ------------------------------------------------------------
  window.UI = window.UI || {};

  const STATE_CLASSES = ['state-ready','state-listening','state-thinking','state-speaking'];
  function setBodyState(next) {
    const b = document.body; if (!b) return;
    STATE_CLASSES.forEach(c => b.classList.remove(c));
    if (next) b.classList.add(`state-${next}`);
  }

  function setVisualState(state /* 'inactive' | 'busy' | 'ready' */) {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('ui-inactive', state === 'inactive');
    b.classList.toggle('ui-busy',     state === 'busy');
    b.classList.toggle('ui-ready',    state === 'ready');
    updateBusyBar(state);
  }

  function updateBusyBar(stateOrStatus) {
    const bar = document.getElementById('busyBar');
    if (!bar) return;
    const s = String(stateOrStatus || '').toLowerCase();
    const isBusy = s.includes('busy') || /starting|thinking|processing|preparing|ending|speaking/.test(s);
    bar.style.width = isBusy ? '100%' : '0';
  }

  function srAnnounce(text) {
    try { const sr = document.getElementById('srStatus'); if (sr) sr.textContent = text || ''; } catch {}
  }

  async function primeMic() {
    try { await window.HARCI_STT?.warmup?.(); } catch (e) { LOG.warn('[ui] stt warmup failed', e); }
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

  // NEW: show/hide bottom controls + tips during warmup
  function setControlsVisible(on) {
    const footer  = document.querySelector('footer');
    const tipsBar = document.getElementById('tipsBar');
    if (footer) {
      footer.style.visibility = on ? 'visible' : 'hidden';
      footer.style.pointerEvents = on ? 'auto' : 'none';
      footer.style.opacity = on ? '1' : '0';
    }
    if (tipsBar) {
      tipsBar.style.visibility = on ? 'visible' : 'hidden';
      tipsBar.style.pointerEvents = on ? 'auto' : 'none';
      tipsBar.style.opacity = on ? '1' : '0';
    }
  }

  // Replace the whole UI.setStatus block with this
UI.setStatus = UI.setStatus || (s => {
  UI.status = s;
  try {
    const el  = document.getElementById('statusText') || document.getElementById('status');
    if (el)  el.textContent = s;

    const txt = String(s || '');

    // Drive body color state
    if (/Listening/i.test(txt))       setBodyState('listening');
    else if (/Speaking/i.test(txt))   setBodyState('speaking');
    else if (/Thinking|Starting|Processing|Preparing|Ending/i.test(txt))
                                      setBodyState('thinking');
    else                              setBodyState('ready');

    updateBusyBar(s);
    srAnnounce(txt);

    if (window.__harci_sessionActive) {
      const isBusy = /Thinking|Starting|Processing|Preparing|Ending|Speaking/i.test(txt);
      if (isBusy) {
        setAllEnabled(false);
        setVisualState('busy');
      } else if (/Ready/i.test(txt)) {
        // <- KEY: always reveal + enable on Ready
        setControlsVisible(true);
        setAllEnabled(true);
        setVisualState('ready');
      }
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
      osc.start(); osc.stop(ctx.currentTime + 0.02);
      LOG.info('[ui] soft audio unlocked');
    } catch (e) {
      LOG.warn('[ui] soft audio unlock failed', e);
    }
  }

  async function ensureOutputAudio() {
    try {
      if (window.HARCI_AVATAR?.ensureAudioUnlocked) {
        await window.HARCI_AVATAR.ensureAudioUnlocked();
      } else {
        await softAudioUnlock();
      }
      window.__audio_unlocked = true;
      try { window.HARCI_AVATAR?.setOutputMuted?.(false); } catch {}
    } catch {}
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
  function onRegisterPage(){
    const f = $('#regForm');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        const r = await window.API.register(fd);
        if (r?.next) location.href = r.next; else location.href = '/guide';
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
    const nudge      = $('#audioNudge');

    // Initial: keep everything hidden/disabled until welcome is fetched
    UI.setStatus('Preparing…');
    setVisualState('busy');
    setBodyState('thinking');
    setAllEnabled(false);
    setControlsVisible(false);          // NEW: hide chips/mic/tips
    nudge?.classList.add('hidden');     // NEW: hide audio nudge during warmup

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

    // Auto-start session, then fetch welcome, then speak, THEN set Ready & reveal UI
    (async () => {
      try {
        primeAudioEl();
        await primeMic();
        if (!await waitForAvatar(3000)) {
          LOG.warn('[ui] avatar not ready yet; continuing (startSession will retry internally)');
        }
        await window.HARCI_AVATAR.startSession();

        sessionActive = true;
        window.__harci_sessionActive = true;

        // End session button appears now...
if (endBtn) { endBtn.classList.remove('hidden'); endBtn.disabled = false; }

// Safety fuse: if controls somehow remain hidden, reveal them after 9s
setTimeout(() => {
  if (!sessionActive) return;
  const footer = document.querySelector('footer');
  const mic    = document.getElementById('btnHoldMic');
  const hidden = footer && getComputedStyle(footer).visibility === 'hidden';
  const disabled = mic && mic.disabled;
  if (hidden || disabled) {
    setControlsVisible(true);
    setAllEnabled(true);
    setVisualState('ready');
    UI.setStatus('Ready');
  }
}, 9000);
        // Fetch welcome with a timeout
        let res = null;
        const ac = new AbortController();
        const t = setTimeout(() => { try { ac.abort(); } catch {} }, 8000); // 8s hard cap
        try {
          res = await window.API.assistWelcome?.({ signal: ac.signal });
        } catch (e) {
          LOG.warn('[ui] welcome timed out or failed', e);
        } finally {
          clearTimeout(t);
        }

        // Render briefing regardless (if any)
        if (res) applyResponse(res);

        // Ensure output audio before speaking
        await ensureOutputAudio();

        // Speak welcome if provided
        if (res?.narration) {
          await speakNow(res.narration, { turn: 'welcome' });
        }

        // Now the agent is truly "ready": reveal UI and switch state
        setControlsVisible(true);
        setAllEnabled(true);
        setVisualState('ready');
        UI.setStatus('Ready');

        // If user still needs a nudge later (e.g., muted OS), you can re-show nudge on demand.
        // nudge?.classList.remove('hidden');

      } catch (err) {
        LOG.error('[ui] auto-start failed', err);
        setAllEnabled(false);
        setControlsVisible(true);   // allow text/mic if we failed welcome
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
        const nudge = document.getElementById('audioNudge');
        nudge?.classList.add('hidden');
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

    // Chips
    const chips = $$('#quickChips [data-prompt], #quickChipsDesk [data-prompt]');
    chips.forEach(btn => btn.addEventListener('click', ()=> {
      if (!sessionActive) { UI.setStatus('Starting…'); return; }
      runPrompt(btn.dataset.prompt);
    }));

    // ---- Mic press & hold (PTT) ---------------------------------------------
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
      try { await ensureOutputAudio(); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const i = getAskInput(); if (i) i.value = 'Listening…';

      muteAvatarOutput(true);

      UI.setStatus('Listening'); UI.setMicEnabled(false);
      try {
        try { holdBtn?.setPointerCapture?.(e.pointerId); } catch {}
        await window.HARCI_STT.beginHold();
        holdBtn?.classList.add('mic-pressed');
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
      holdBtn?.classList.remove('mic-pressed');
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
      holdBtn.addEventListener('pointerdown', press,   { passive: false });
      holdBtn.addEventListener('pointerup',   release, { passive: false });
      holdBtn.addEventListener('pointercancel', release, { passive: false });
      holdBtn.addEventListener('pointerleave',  release, { passive: false });
      window.addEventListener('pointerup', release, { passive: false });
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
  if (document.getElementById('remoteVideo')) onGuidePage();
})();
