(function(){
  try {
    const elms = document.querySelectorAll('[data-event-name]');
    const name = (window.HARCI_CONFIG && window.HARCI_CONFIG.event && window.HARCI_CONFIG.event.name) || '';
    elms.forEach(el => { if (name) el.textContent = name; });
  } catch {}
})();
