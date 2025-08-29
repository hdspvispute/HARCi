// app/static/js/ui_bindings.js
(() => {
  'use strict';

  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- UI helpers ------------------------------------------------------------
  window.UI = window.UI || {};
  UI.setStatus = UI.setStatus || (s => {
    UI.status = s;
    try {
      const el  = document.getElementById('statusText') || document.getElementById('status');
      const dot = document.getElementById('statusDot');
      if (el)  el.textContent = s;
      if (dot) {
        if (/Listening/i.test(s)) dot.style.background = 'var(--brand-red)';
        else if (/Thinking|Starting|Processing|Ending/i.test(s)) dot.style.background = '#F59E0B'; // amber
        else dot.style.background = '#10B981'; // green
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

  function setChipsEnabled(on){ $$('#quickChips [data-prompt]').forEach(c => c.disabled = !on); }
  function setTypedEnabled(on){
    const i = $('#txtAsk'), b = $('#btnAsk');
    if (i) i.disabled = !on;
    if (b) b.disabled = !on;
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
        const r = await window.API.register(fd); // fixed: use window.API
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
    const sessionBtn = $('#btnSessionToggle') || $('#btnStartSession'); // one toggle button
    const holdBtn    = $('#btnHoldMic');
    const askForm    = $('#askForm');
    const askInput   = $('#txtAsk');
    const chips      = $$('#quickChips [data-prompt]');

    UI.setStatus('Tap start');

    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false; audio.volume = 1.0; audio.playsInline = true;
        if (!audio.srcObject) audio.srcObject = new MediaStream();
        audio.play?.().catch(()=>{});
      } catch {}
    }

    // Use Ask input as live caption
    const setCaption = (t) => { if (askInput) askInput.value = t ?? ''; };

    // Initially lock user inputs until welcome begins
    setChipsEnabled(false);
    UI.setMicEnabled(false);
    setTypedEnabled(false);

    let welcomed = false;
    let sessionActive = false;

    async function runAgentWelcome() {
      if (welcomed) return;
      welcomed = true;

      UI.setStatus('Thinking…');
      const welcomeAC = new AbortController();
      try {
        let res = null;
        if (typeof window.API.assistWelcome === 'function') {
          res = await window.API.assistWelcome(undefined, { signal: welcomeAC.signal });
        } else {
          // Fallback to avoid 400: send a safe non-empty seed
          res = await window.API.assistRun('Welcome me', undefined, { signal: welcomeAC.signal });
        }

        if (res) {
          applyResponse(res);

          // Enable controls just before narration
          setChipsEnabled(true);
          UI.setMicEnabled(true);
          setTypedEnabled(true);

          if (res.narration) {
            await speakNow(res.narration, { turn: 'welcome' });
          }
        }
        UI.setStatus('Ready');
      } catch (err) {
        // Fallback local welcome so UX still flows
        setChipsEnabled(true);
        UI.setMicEnabled(true);
        setTypedEnabled(true);
        await speakNow('Welcome! I’m HARCi. Ask me about the agenda, venue map, or speakers — or press and hold the mic to talk.');
        UI.setStatus('Ready');
      }
    }

    async function startSessionFlow(){
      if (sessionBtn) sessionBtn.disabled = true;
      UI.setStatus('Starting…');

      if (await waitForAvatar(800)) {
        try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch { await softAudioUnlock(); }
      } else {
        await softAudioUnlock();
      }
      primeAudioEl();

      if (!await waitForAvatar(3000)) {
        LOG.warn('[ui] avatar not ready yet; continuing (startSession will retry internally)');
      }
      await window.HARCI_AVATAR.startSession();

      sessionActive = true;
      if (sessionBtn) { sessionBtn.textContent = 'End session'; sessionBtn.disabled = false; }

      await runAgentWelcome();

      
    }

    async function endSessionFlow(){
      if (sessionBtn) sessionBtn.disabled = true;
      UI.setStatus('Ending…');
      cancelPending('end');

      try {
        const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
        await window.API.sessionEnd(sid);
      } catch {}

      setChipsEnabled(false);
      UI.setMicEnabled(false);
      setTypedEnabled(false);

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
      const myTurn = ++turnSeq;
      cancelPending('chip');
      setChipsEnabled(false);
      UI.setStatus('Thinking…'); UI.setMicEnabled(false); setTypedEnabled(false);

      const brief = $('#briefing'); if (brief) brief.innerHTML = '';

      const ac = new AbortController(); inflight = ac;
      let res = null;
      try {
        res = await window.API.assistRun(p, undefined, { signal: ac.signal });
      } catch (e) {
        if (e.name !== 'AbortError') UI.setStatus('Error');
        setChipsEnabled(true); UI.setMicEnabled(true); setTypedEnabled(true);
        return;
      } finally {
        inflight = null;
      }

      if (myTurn !== turnSeq || !res) { setChipsEnabled(true); UI.setMicEnabled(true); setTypedEnabled(true); return; }

      applyResponse(res);
      speakNow(res.narration || 'Here is the information.', { turn: myTurn });

      setChipsEnabled(true); UI.setMicEnabled(true); setTypedEnabled(true);
    }

    // Quick chips
    chips.forEach(btn => btn.addEventListener('click', ()=> runPrompt(btn.dataset.prompt)));

    // ---- Mic press & hold ----------------------------------------------------
    let isHolding = false;
    let holdToken = 0;

    if (window.HARCI_STT && typeof window.HARCI_STT.on === 'function') {
      window.HARCI_STT.on('partial', ({ text }) => {
        if (!isHolding) return;
        setCaption(text || '…');
      });
      window.HARCI_STT.on('final', ({ text }) => {
        if (!isHolding) return;
        setCaption(text || '');
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
      setCaption('Listening…');

      UI.setStatus('Listening'); UI.setMicEnabled(false);
      try {
        await window.HARCI_STT.beginHold();
        holdBtn?.classList.add('ring-2','ring-white/50');
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

      holdBtn?.classList.remove('ring-2','ring-white/50');
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
        setCaption('');
        UI.setStatus('Ready'); UI.setMicEnabled(true);
        return;
      }

      setCaption(text);
      await runPrompt(text);
      UI.setStatus('Ready'); UI.setMicEnabled(true);
    };

    if (holdBtn) {
      holdBtn.addEventListener('pointerdown', press);
      holdBtn.addEventListener('pointerup', release);
      holdBtn.addEventListener('pointercancel', release);
      holdBtn.addEventListener('pointerleave', release);
    }

    // Keyboard accessibility for mic (space to hold)
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        if (!e.repeat) holdBtn?.dispatchEvent(new PointerEvent('pointerdown'));
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        holdBtn?.dispatchEvent(new PointerEvent('pointerup'));
        e.preventDefault();
      }
    });

    // Typed questions
    askForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (askInput?.value || '').trim();
      if (!text) return;
      askInput.value = '';
      await runPrompt(text);
    });
  }

  // ---- Route by presence -----------------------------------------------------
  if (document.getElementById('regForm')) onRegisterPage();
  if (document.getElementById('unlockCard') || document.getElementById('btnUnlock')) onTransitionPage();
  if (document.getElementById('remoteVideo')) onGuidePage();
})();
