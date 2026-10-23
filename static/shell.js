/* Shared progressive enhancement for ProjectHouseBuilder navigation. No network dependencies. */
(() => {
  'use strict';
  const root = document.body;
  const aside = document.getElementById('phbSidebar');
  const menu = document.getElementById('phbMenu');
  const scrim = document.getElementById('phbSidebarScrim');
  const collapse = document.getElementById('phbCollapse');
  if (!aside || !menu || !scrim) return;
  let previousFocus = null;
  const mobile = () => window.matchMedia('(max-width: 900px)').matches;
  const navLinks = [...aside.querySelectorAll('.phb-nav-link[data-section]')];

  const currentSection = () => {
    const path = window.location.pathname;
    if (path === '/kosten') return 'kosten';
    if (path === '/angebote') return 'angebote';
    if (path === '/daten') return 'daten';
    if (path === '/stammdaten') return 'stammdaten';
    if (path === '/dokumente') return 'dokumente';
    if (path === '/finanzierung') return 'finanzierung';
    return path === '/belege' ? 'belege' : 'zeitplan';
  };
  const updateCurrent = () => {
    const active = currentSection();
    for (const link of navLinks) {
      const selected = link.dataset.section === active;
      link.classList.toggle('is-current', selected);
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };
  const setOpen = open => {
    root.classList.toggle('phb-nav-open', !!open);
    menu.setAttribute('aria-expanded', String(!!open));
    menu.setAttribute('aria-label', open ? 'Navigation schließen' : 'Navigation öffnen');
    // Keep hidden links out of keyboard navigation while the drawer is closed.
    if (mobile()) {
      aside.inert = !open;
    } else {
      aside.inert = false;
    }
    if (open) {
      previousFocus = document.activeElement;
      const first = aside.querySelector('a.phb-brand-link');
      if (first) first.focus();
    } else if (mobile() && previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
      previousFocus = null;
    }
  };
  const applyViewport = () => {
    if (!mobile()) root.classList.remove('phb-nav-open');
    aside.inert = mobile() && !root.classList.contains('phb-nav-open');
    menu.setAttribute('aria-expanded', String(root.classList.contains('phb-nav-open')));
  };
  menu.addEventListener('click', () => setOpen(!root.classList.contains('phb-nav-open')));
  scrim.addEventListener('click', () => setOpen(false));
  aside.addEventListener('click', e => {
    const link = e.target.closest('.phb-nav-link[data-section]');
    if (link && mobile()) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && root.classList.contains('phb-nav-open')) {
      e.preventDefault(); setOpen(false);
    }
    if (e.key !== 'Tab' || !root.classList.contains('phb-nav-open')) return;
    const focusable = [...aside.querySelectorAll('a[href],button:not([disabled]),summary')].filter(el => el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {e.preventDefault();last.focus();}
    else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first.focus();}
  });
  if (collapse) {
    try {if (window.localStorage.getItem('phb-sidebar-collapsed') === '1') root.classList.add('phb-sidebar-collapsed');} catch (_) {}
    const syncCollapse = () => {
      const collapsed = root.classList.contains('phb-sidebar-collapsed');
      collapse.setAttribute('aria-expanded', String(!collapsed));
      collapse.setAttribute('aria-label', collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen');
      collapse.title = collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen';
    };
    collapse.addEventListener('click', () => {
      root.classList.toggle('phb-sidebar-collapsed');
      try {window.localStorage.setItem('phb-sidebar-collapsed', root.classList.contains('phb-sidebar-collapsed') ? '1' : '0');} catch (_) {}
      syncCollapse();
    });
    syncCollapse();
  }
  window.addEventListener('hashchange', updateCurrent);
  window.addEventListener('resize', applyViewport);
  updateCurrent(); applyViewport();
})();
