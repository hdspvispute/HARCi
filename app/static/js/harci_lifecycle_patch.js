// app/static/js/harci_lifecycle_patch.js
(function () {
  const g = window; if (!g) return;

  // --- tiny helpers used only here -------------------------------------------
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function setChipsEnabled(on){
    try {
      $$('#quickChips [data-prompt], #quickChipsDesk [data-prompt]')
        .forEach(c => { c.disabled = !on; });
    } catch {}
  }
  function setTypedEnabled(on){
    try {
      const i = $('#txtAsk') || $('#txtAskDesk');
      const b = $('#btnAsk') || $('#btnAskDesk');
      if (i) i.disabled = !on;
      if (b) b.disabled = !on;
    } catch {}
  }
  function setMicEnabled(on){
    try { const b = $('#btnHoldMic'); if (b) b.disabled = !on; } catch {}
  }
  function setAllEnabled(on){
    setChipsEnabled(on);
    setTypedEnabled(on);
    setMicEnabled(on);
  }

  // public UI namespace (lifecycle-safe default)
  g.UI = g.UI || {};

  // Allow other files to call this too if they need just the mic toggle
  g.UI.setMicEnabled = g.UI.setMicEnabled || setMicEnabled;

  // Unified status setter used by early-loading scripts (Avatar, STT) before ui_bindings.js
  g.UI.setStatus = function setStatus(s) {
    g.UI.status = s;
    try {
      const el  = document.getElementById('statusText') || document.getElementById('status');
      const dot = document.getElementById('statusDot');
      if (el)  el.textContent = s || '';

      // dot color
      if (dot) {
        if (/Listening/i.test(s)) dot.style.background = 'var(--brand-red)';
        else if (/Thinking|Starting|Processing|Preparing|Ending/i.test(s)) dot.style.background = '#F59E0B';
        else dot.style.background = '#10B981';
      }

      // gate interactivity only after a session is active
      if (g.__harci_sessionActive) {
        const isBusy =
          /Thinking|Starting|Processing|Preparing|Ending/i.test(s) &&
          !/Ready/i.test(s);

        if (isBusy) {
          document.body.classList.add('ui-busy');
          document.body.classList.remove('ui-ready','ui-inactive');
          setAllEnabled(false);
        } else if (/Ready/i.test(s)) {
          document.body.classList.add('ui-ready');
          document.body.classList.remove('ui-busy','ui-inactive');
          setAllEnabled(true);
        }
      }
    } catch {}
  };
})();
