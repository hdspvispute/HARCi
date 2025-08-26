// ui_bindings.js
(() => {
  'use strict';
  const LOG = (window.HARCI_LOG && window.HARCI_LOG.child) ? window.HARCI_LOG.child('ui') : console;

  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- Status helper --------------------------------------------------------
  function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    else LOG.info('[ui] status:', msg);
  }

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

  // ---- Guide page -----------------------------------------------------------
  async function onGuidePage(){
    await window.bootstrapConfig();

    const video = $('#remoteVideo');
    const audio = $('#remoteAudio');
    LOG.info('[ui] guide: video/audio elements', { video: !!video, audio: !!audio });
    setStatus('Tap start');

    // Prepare audio element so it can play programmatically after gesture
    function primeAudioEl() {
      try {
        if (!audio) return;
        audio.muted = false;
        audio.volume = 1.0;
        audio.playsInline = true;
        // Some browsers need a tiny, empty stream to allow .play() pre-start
        if (!audio.srcObject) audio.srcObject = new MediaStream();
        audio.play?.().catch(()=>{});
      } catch {}
    }

    // Start only on user tap (button preferred, body fallback)
    const startBtn = document.getElementById('btnStartSession') || document.body;
    startBtn.addEventListener('click', async () => {
      try {
        setStatus('Starting…');
        LOG.info('[ui] avatar: unlocking audio');
        await window.HARCI_AVATAR.ensureAudioUnlocked(); // user-gesture bound
        primeAudioEl();

        LOG.info('[ui] avatar: starting session');
        await window.HARCI_AVATAR.startSession();

        // Kick: some SDK builds push remote tracks only after first speak
        setStatus('Ready');
        LOG.info('[ui] avatar: ready, about to speak welcome');
        // Speak welcome message
        await window.HARCI_AVATAR.speak('Welcome to the event! I am your HARCi avatar guide. I can answer questions about the agenda, venue, speakers, and help you navigate the event. Just tap a quick chip or hold the mic to talk to me.');
        LOG.info('[ui] avatar: finished speaking welcome');
        } catch (e) {
        LOG.error('[ui] avatar start error', e);
        setStatus('Retrying…');
      }
    }, { once: true });

    // Quick chips
    const chips = $$('#quickChips [data-prompt]');
    async function runPrompt(p){
      try {
        chips.forEach(c=> c.disabled = true);
        setStatus('Thinking…');

        // Stop any ongoing avatar speech and clear UI
        await window.HARCI_AVATAR.stopSpeaking();
        $('#caption') && ($('#caption').textContent = '');
        const brief = $('#briefing');
        if (brief) brief.innerHTML = '';

        // Ask agent
        const res = await (window.ask ? window.ask(p) : API.assistRun(p));

        // Render + speak
        applyResponse(res);
        setStatus('Speaking…');
        await window.HARCI_AVATAR.speak(res.narration || 'Here is the information.');
        setStatus('Ready');
      } catch (e) {
        LOG.error('[ui] chip error', e);
        setStatus('Error');
      } finally {
        chips.forEach(c=> c.disabled = false);
      }
    }
    chips.forEach(btn => btn.addEventListener('click', ()=> runPrompt(btn.dataset.prompt)));

    // Mic press & hold (guard for modules)
    const hold = $('#btnHoldMic');
    let partialListener = null;
    const press = async (e) => {
      e.preventDefault();
      try { await window.HARCI_AVATAR.ensureAudioUnlocked(); } catch {}
      try { window.EARCON?.start?.(); } catch {}
      $('#caption') && ($('#caption').textContent = 'Listening…');
      // Attach partial listener only while holding
      partialListener = ({ text }) => { $('#caption') && ($('#caption').textContent = text); };
      window.HARCI_STT.on('partial', partialListener);
      await window.HARCI_STT.beginHold();
      hold.classList.add('ring-2','ring-white/50');
    };
    const release = async (e) => {
      e.preventDefault();
      hold.classList.remove('ring-2','ring-white/50');
      try { window.EARCON?.stop?.(); } catch {}
      const { text } = await window.HARCI_STT.endHold();
      // Remove partial listener after release
      if (partialListener) {
        // Remove all listeners for 'partial' (simple approach)
        window.HARCI_STT.listeners = window.HARCI_STT.listeners || {};
        window.HARCI_STT.listeners['partial'] = [];
        partialListener = null;
      }
      if (!text) { $('#caption') && ($('#caption').textContent = ''); return; }
      // Show recognized speech before sending to agent
      $('#caption') && ($('#caption').textContent = text);
      runPrompt(text);
      // Ensure askInput is editable
      const askInput = document.getElementById('askInput');
      if (askInput) {
        askInput.removeAttribute('disabled');
        askInput.removeAttribute('readonly');
      }
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
