// ui_bindings.js — DROP-IN (unified status, safe STT lifecycle, avatar-friendly)
// Keeps existing routes/IDs and behavior, but fixes "stuck Speaking" loops and listener leaks.
(() => {
  'use strict';
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- Unified Status + Mic helpers (backward compatible) -------------------
  (function initUiHelpers() {
    function updateStatusDom(msg) {
      let touched = false;
      const el1 = document.getElementById('status');      // legacy target
      if (el1) { el1.textContent = msg; touched = true; }
      const el2 = document.getElementById('statusText');  // new target
      if (el2) { el2.textContent = msg; touched = true; }
      try { document.documentElement.dataset.harciStatus = String(msg || '').toLowerCase(); } catch {}
      if (!touched) LOG.info('[ui] status:', msg);
    }

    // Public UI API
    window.UI = window.UI || {};
    UI.setStatus = (s) => { UI.status = s; updateStatusDom(s); };
    UI.setMicEnabled = (on) => {
      const b = document.getElementById('btnHoldMic');
      if (!b) return;
      b.disabled = !on;
      b.classList.toggle('is-disabled', !on);
      b.setAttribute('aria-disabled', (!on).toString());
    };

    // Back-compat: keep global setStatus working by delegating
    window.setStatus = (msg) => UI.setStatus(msg);
  })();

  // ---- MD-lite sanitizer ----------------------------------------------------
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

  // ---- Global cfg bootstrap -------------------------------------------------
  window.bootstrapConfig = async () => {
    if (window.HARCI_CONFIG) return window.HARCI_CONFIG;
    try {
      window.HARCI_CONFIG = await window.API.config();
    } catch (e) {
      LOG.error('[ui] config error', e);
      window.HARCI_CONFIG = {};
    }
    return window.HARCI_CONFIG;
  };

  // ---- Transition page ("Tap to continue") ---------------------------------
  function onTransitionPage() {
    const btn = document.getElementById('btnUnlock');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await window.bootstrapConfig();
        await window.HARCI_AVATAR?.ensureAudioUnlocked?.();  // satisfies autoplay policies
      } catch {}
      window.location.href = '/guide';
    }, { once: true });
  }

  // ---- Register page --------------------------------------------------------
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

  // ---- Safe speak with timeout (prevents "stuck Speaking") ------------------
  async function speakSafe(text, opts = {}) {
    try {
      UI.setStatus('Speaking…');
      UI.setMicEnabled(false);
      const p = window.HARCI_AVATAR?.speak?.(text, opts);
      // If lifecycle patch is present, speak() resolves on completion.
      // If not, we still avoid deadlock by timing out.
      await Promise.race([
        p,
        new Promise(res => setTimeout(res, 12000)) // 12s safety
      ]);
    } catch (e) {
      LOG.error('[ui] speakSafe error', e);
    } finally {
      UI.setStatus('Ready');
      UI.setMicEnabled(true);
    }
  }

  // ---- Guide page -----------------------------------------------------------
  async function onGuidePage(){
    await window.bootstrapConfig();

    const video = $('#remoteVideo');
    const audio = $('#remoteAudio');
    LOG.info('[ui] guide: video/audio elements', { video: !!video, audio: !!audio });
    UI.setStatus('Tap start');

    // Prepare audio element so it can play programmatically after gesture
    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false;
        audio.volume = 1.0;
        audio.playsInline = true;
        if (!audio.srcObject) audio.srcObject = new MediaStream(); // allow .play() on some browsers
        audio.play?.().catch(()=>{});
      } catch {}
    }

    // Start only on user tap (button preferred, body fallback)
    const startBtn = document.getElementById('btnStartSession') || document.body;
    startBtn.addEventListener('click', async () => {
      try {
        UI.setStatus('Starting…');
        UI.setMicEnabled(false);

        LOG.info('[ui] avatar: unlocking audio');
        await window.HARCI_AVATAR.ensureAudioUnlocked(); // user-gesture bound
        primeAudioEl();

        LOG.info('[ui] avatar: starting session');
        await window.HARCI_AVATAR.startSession();

        UI.setStatus('Ready');
        LOG.info('[ui] avatar: ready, speak welcome');

        await speakSafe(
          'Welcome to the event! I am your HARCi avatar guide. I can answer questions about the agenda, venue, speakers, and help you navigate the event. Just tap a quick chip or hold the mic to talk to me.'
        );
      } catch (e) {
        LOG.error('[ui] avatar start error', e);
        UI.setStatus('Retrying…');
        UI.setMicEnabled(true);
      }
    }, { once: true });

    // Quick chips
    const chips = $$('#quickChips [data-prompt]');
    async function runPrompt(p){
      try {
        chips.forEach(c=> c.disabled = true);
        UI.setStatus('Thinking…');
        UI.setMicEnabled(false);

        // Stop any ongoing avatar speech
        try {
          if (typeof window.HARCI_AVATAR?.stopSpeaking === 'function') {
            await window.HARCI_AVATAR.stopSpeaking();
          } else {
            // Fallback if lifecycle patch exposes HARCI_SPEECH.stop()
            window.HARCI_SPEECH?.stop?.('chip');
          }
        } catch {}

        // Clear UI
        const cap = $('#caption'); if (cap) cap.textContent = '';
        const brief = $('#briefing'); if (brief) brief.innerHTML = '';

        // Ask agent
        const res = await (window.ask ? window.ask(p) : API.assistRun(p));

        // Render + speak
        applyResponse(res);
        await speakSafe(res?.narration || 'Here is the information.');
      } catch (e) {
        LOG.error('[ui] chip error', e);
        UI.setStatus('Error');
      } finally {
        chips.forEach(c=> c.disabled = false);
        UI.setMicEnabled(true);
      }
    }
    chips.forEach(btn => btn.addEventListener('click', ()=> runPrompt(btn.dataset.prompt)));

    // Mic press & hold — single partial listener (no leaks), guard by flag
    const hold = $('#btnHoldMic');
    let isHolding = false;

    // Attach a single partial listener once; update caption only while holding
    if (window.HARCI_STT && typeof window.HARCI_STT.on === 'function') {
      window.HARCI_STT.on('partial', ({ text }) => {
        if (!isHolding) return;
        const cap = $('#caption'); if (cap) cap.textContent = text || '…';
      });
      // Optional: if STT emits 'final', you can update too
      if (typeof window.HARCI_STT.on === 'function') {
        window.HARCI_STT.on('final', ({ text }) => {
          if (!isHolding) return;
          const cap = $('#caption'); if (cap) cap.textContent = text || '';
        });
      }
    }

    const press = async (e) => {
      e.preventDefault();
      try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      const cap = $('#caption'); if (cap) cap.textContent = 'Listening…';

      // If avatar is speaking, preempt so user can talk immediately
      try {
        if (window.HARCI_SPEECH?.speaking) window.HARCI_SPEECH.stop?.('ptt');
        if (typeof window.HARCI_AVATAR?.stopSpeaking === 'function') {
          await window.HARCI_AVATAR.stopSpeaking();
        }
      } catch {}

      isHolding = true;
      UI.setStatus('Listening');
      UI.setMicEnabled(false);

      try {
        await window.HARCI_STT.beginHold();
        hold?.classList.add('ring-2','ring-white/50');
      } catch (err) {
        LOG.warn('[ui] beginHold failed', err);
        isHolding = false;
        UI.setStatus('Ready');
        UI.setMicEnabled(true);
      }
    };

    const release = async (e) => {
      e.preventDefault();
      hold?.classList.remove('ring-2','ring-white/50');
      try { window.EARCON?.stop?.(); } catch {}

      const { text } = await window.HARCI_STT.endHold();
      isHolding = false;
      UI.setStatus('Processing…');

      if (!text) { const cap = $('#caption'); if (cap) cap.textContent = ''; UI.setStatus('Ready'); UI.setMicEnabled(true); return; }

      // Show recognized speech before sending to agent
      const cap = $('#caption'); if (cap) cap.textContent = text;

      // Ensure askInput is editable
      const askInput = document.getElementById('askInput');
      if (askInput) {
        askInput.removeAttribute('disabled');
        askInput.removeAttribute('readonly');
      }

      // Run prompt
      await runPrompt(text);
      UI.setStatus('Ready');
      UI.setMicEnabled(true);
    };

    if (hold) {
      hold.addEventListener('pointerdown', press);
      hold.addEventListener('pointerup', release);
      hold.addEventListener('pointercancel', release);
      hold.addEventListener('pointerleave', release);
      hold.addEventListener('touchstart', press, { passive:false });
      hold.addEventListener('touchend', release);
    }

    // End session
    $('#btnEnd')?.addEventListener('click', async ()=> {
      try {
        const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
        await API.sessionEnd(sid);
      } catch {}
      location.href = '/ended';
    });
  }

  // ---- Apply agent response -------------------------------------------------
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

  // ---- Minimal ask() helper -------------------------------------------------
  window.ask = async (text) => {
    const sid = document.cookie.replace(/(?:(?:^|.*;\s*)harci_sid\s*=\s*([^;]*).*$)|^.*$/, "$1");
    return window.API.assistRun(text, sid);
  };

  // ---- Route by presence of elements ---------------------------------------
  if (document.getElementById('regForm')) onRegisterPage();
  if (document.getElementById('unlockCard') || document.getElementById('btnUnlock')) onTransitionPage();
  if (document.getElementById('remoteVideo')) onGuidePage();

  LOG.info('[ui] wired', window.HARCI_CONFIG || {});
})();
