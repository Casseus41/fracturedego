// ═══════════════════════════════════════════════
//   fractured Ego — Quick Exit
//   One tap (or Esc pressed 3× quickly) instantly replaces this page
//   with a neutral site. Standard safety pattern for sites used by
//   people who may be monitored. No dependencies; loads on every page.
//
//   To disable everywhere: set QUICK_EXIT_ENABLED = false.
//   To hide on one page: <body data-quick-exit="off">
// ═══════════════════════════════════════════════
(function () {
  const QUICK_EXIT_ENABLED = true;
  const QUICK_EXIT_URL = 'https://www.google.com/search?q=weather+today';

  if (!QUICK_EXIT_ENABLED) return;

  function quickExit() {
    try { sessionStorage.clear(); } catch (_) {}
    try {
      document.title = 'Weather';
      document.documentElement.style.background = '#fff';
      document.body.innerHTML = '';
      // Replace the current history entry so Back doesn't return here
      history.replaceState(null, '', '/');
    } catch (_) {}
    window.location.replace(QUICK_EXIT_URL);
  }
  window.feQuickExit = quickExit;

  // Esc ×3 within 1.2s
  let presses = [];
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const now = Date.now();
    presses = presses.filter((t) => now - t < 1200);
    presses.push(now);
    if (presses.length >= 3) quickExit();
  });

  function mount() {
    if (document.body.dataset.quickExit === 'off') return;
    if (document.getElementById('fe-quick-exit')) return;
    const btn = document.createElement('button');
    btn.id = 'fe-quick-exit';
    btn.type = 'button';
    btn.className = 'quick-exit';
    btn.setAttribute('aria-label', 'Quick exit — leave this site immediately');
    btn.title = 'Leave immediately (or press Esc 3 times)';
    btn.innerHTML = '<span aria-hidden="true">✕</span> Quick exit';
    btn.addEventListener('click', quickExit);
    document.body.appendChild(btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
