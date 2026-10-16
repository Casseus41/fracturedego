// ═══════════════════════════════════════════════
//   fractured Ego — Member shell
//   Pages declare:
//     <nav class="topnav" data-shell="topnav"></nav>
//     <aside class="sidebar" data-shell="sidebar" data-active="feed"></aside>
//   Exposes window.FE = { ready: Promise<{user, profile, member, isAdmin}> }
//   Emits document events: fe:message, fe:notification, fe:post
// ═══════════════════════════════════════════════
(function () {
  const ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    feed: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  };

  const NAV = [
    { heading: 'Overview', items: [
      { key: 'dashboard', href: 'dashboard.html', icon: '🏠', label: 'Dashboard' },
      { key: 'requests', href: 'requests.html', icon: '📋', label: 'My Requests' },
    ]},
    { heading: 'Community', items: [
      { key: 'feed', href: 'feed.html', icon: '🌙', label: 'Feed' },
      { key: 'messages', href: 'messages.html', icon: '💬', label: 'Messages', badge: 'msg' },
      { key: 'members', href: 'members.html', icon: '👥', label: 'Members' },
      { key: 'profile', href: 'profile.html', icon: '🪞', label: 'My Profile' },
    ]},
    { heading: 'Member Tools', items: [
      { key: 'request', href: 'request.html', icon: '✨', label: 'New Request' },
      { key: 'codes', href: 'my-codes.html', icon: '🔑', label: 'My Access Codes' },
      { key: 'invite', href: 'invite-request.html', icon: '✉️', label: 'Invite Someone' },
    ]},
    { heading: 'Account', items: [
      { key: 'contact', href: 'contact-sibeth.html', icon: '📇', label: 'Contact Sibeth' },
      { key: 'settings', href: 'account.html', icon: '⚙️', label: 'Settings' },
      { key: 'admin', href: 'admin.html', icon: '🔧', label: 'Admin Panel', adminOnly: true },
    ]},
  ];
  const TABS = [
    { key: 'dashboard', href: 'dashboard.html', icon: ICON.home, label: 'Home' },
    { key: 'feed', href: 'feed.html', icon: ICON.feed, label: 'Feed' },
    { key: 'messages', href: 'messages.html', icon: ICON.chat, label: 'Messages', badge: 'msg' },
    { key: 'members', href: 'members.html', icon: ICON.users, label: 'Members' },
  ];

  const topnav = document.querySelector('[data-shell="topnav"]');
  const sidebar = document.querySelector('[data-shell="sidebar"]');
  const active = sidebar?.dataset.active || document.body.dataset.active || '';

  function renderTopnav() {
    if (!topnav) return;
    topnav.innerHTML = `
      <div class="nav-left">
        <a href="dashboard.html" class="nav-brand"><img src="../logo.svg" alt="" class="brand-logo"/>fractured <span class="accent">E</span>go</a>
      </div>
      <div class="nav-right">
        <a href="messages.html" class="nav-icon-btn hide-mobile" aria-label="Messages">${ICON.chat}<span class="nav-badge" data-badge="msg" hidden></span></a>
        <div class="notif-wrap">
          <button type="button" class="nav-icon-btn" id="shell-notif-btn" aria-label="Notifications" aria-expanded="false">${ICON.bell}<span class="nav-badge" data-badge="notif" hidden></span></button>
          <div class="notif-panel" id="shell-notif-panel" hidden>
            <div class="notif-head"><span>Notifications</span><button type="button" id="shell-notif-readall">Mark all read</button></div>
            <div class="notif-list" id="shell-notif-list"><div class="muted-line">Loading…</div></div>
          </div>
        </div>
        <a href="profile.html" class="nav-user-pill" id="shell-user-pill"><span class="av av-xs" id="shell-avatar"><span>?</span></span><span class="hide-mobile" id="shell-name">…</span></a>
        <button type="button" class="btn btn-ghost btn-sm hide-mobile" onclick="signOut()">Sign out</button>
        <span id="nav-name" hidden></span><span id="nav-avatar" hidden></span>
      </div>`;
  }

  function renderSidebar() {
    if (!sidebar) return;
    sidebar.setAttribute('aria-label', 'Member navigation');
    sidebar.innerHTML = NAV.map((sec) => `
      <div class="sidebar-section"><div class="sidebar-heading">${sec.heading}</div>
        ${sec.items.map((it) => `<a href="${it.href}" class="sidebar-link${it.key === active ? ' active' : ''}${it.adminOnly ? ' hidden' : ''}"${it.adminOnly ? ' id="admin-link"' : ''}${it.key === active ? ' aria-current="page"' : ''}>
          <span class="icon">${it.icon}</span> ${it.label}${it.badge ? `<span class="count" data-badge="${it.badge}" hidden></span>` : ''}</a>`).join('')}
      </div>`).join('') + `
      <div class="sidebar-footer">
        <div class="sidebar-user"><span class="av av-sm" id="shell-sb-avatar"><span>?</span></span>
          <div class="info"><div class="name" id="shell-sb-name"></div><div class="role" id="shell-sb-role">Member</div></div></div>
        <button type="button" class="btn btn-ghost btn-sm btn-full" onclick="signOut()">Sign out</button>
        <span id="sb-avatar" hidden></span><span id="sb-name" hidden></span><span id="sb-role" hidden></span>
      </div>`;

    const bar = document.createElement('nav');
    bar.className = 'tabbar'; bar.setAttribute('aria-label', 'Primary');
    bar.innerHTML = TABS.map((t) => `<a href="${t.href}" class="tabbar-item${t.key === active ? ' active' : ''}">${t.icon}<span>${t.label}</span>${t.badge ? `<i class="tab-dot" data-badge="${t.badge}" hidden></i>` : ''}</a>`).join('') +
      `<button type="button" class="tabbar-item" id="shell-menu-btn" aria-expanded="false">${ICON.menu}<span>Menu</span></button>`;
    document.body.appendChild(bar);
    const scrim = document.createElement('div'); scrim.className = 'shell-scrim'; document.body.appendChild(scrim);
    const toggle = (open) => {
      document.body.classList.toggle('shell-menu-open', open);
      document.getElementById('shell-menu-btn').setAttribute('aria-expanded', open);
    };
    document.getElementById('shell-menu-btn').addEventListener('click', () => toggle(!document.body.classList.contains('shell-menu-open')));
    scrim.addEventListener('click', () => toggle(false));
  }

  function setBadge(kind, n) {
    document.querySelectorAll(`[data-badge="${kind}"]`).forEach((el) => {
      el.hidden = !n; if (el.tagName !== 'I') el.textContent = n > 99 ? '99+' : n;
    });
  }

  async function refreshMsgBadge() { setBadge('msg', await unreadMessageCount()); }
  async function refreshNotifBadge() { setBadge('notif', await unreadNotificationCount()); }

  async function renderNotifications() {
    const list = document.getElementById('shell-notif-list');
    try {
      const items = await listNotifications(25);
      if (!items.length) { list.innerHTML = '<div class="notif-empty">You’re all caught up.</div>'; return; }
      list.innerHTML = items.map((n) => {
        const t = notificationText(n);
        return `<a class="notif-item${n.read_at ? '' : ' unread'}" href="${esc(n.link || '#')}" data-id="${n.id}">
          ${n.actor ? avatarHTML(n.actor, 'sm') : `<span class="notif-icon">${t.icon}</span>`}
          <span class="notif-body"><span class="notif-text">${t.html}</span><span class="notif-time">${timeAgo(n.created_at)}</span></span></a>`;
      }).join('');
      hydrateMedia(list);
    } catch (e) { list.innerHTML = '<div class="notif-empty">Couldn’t load notifications.</div>'; }
  }

  function wireNotifications() {
    const btn = document.getElementById('shell-notif-btn'); if (!btn) return;
    const panel = document.getElementById('shell-notif-panel');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', open);
      if (open) await renderNotifications();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.notif-wrap')) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    panel.addEventListener('click', async (e) => {
      const item = e.target.closest('.notif-item');
      if (item?.classList.contains('unread')) { e.preventDefault(); await markNotificationsRead([item.dataset.id]); location.href = item.getAttribute('href'); }
    });
    document.getElementById('shell-notif-readall').addEventListener('click', async () => {
      await markNotificationsRead(); setBadge('notif', 0);
      panel.querySelectorAll('.unread').forEach((el) => el.classList.remove('unread'));
    });
  }

  function subscribeRealtime(uid) {
    try {
      sb.channel('fe-shell-' + uid)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => {
          refreshNotifBadge(); document.dispatchEvent(new CustomEvent('fe:notification', { detail: p.new }));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => {
          if (p.new?.sender_id !== uid) refreshMsgBadge();
          document.dispatchEvent(new CustomEvent('fe:message', { detail: { type: p.eventType, row: p.new } }));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (p) => {
          document.dispatchEvent(new CustomEvent('fe:post', { detail: p.new }));
        })
        .subscribe();
    } catch (e) { console.warn('Realtime unavailable, using polling', e); }
    // Polling safety net (realtime can drop on flaky mobile networks)
    setInterval(() => { if (!document.hidden) { refreshMsgBadge(); refreshNotifBadge(); } }, 45000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshMsgBadge(); refreshNotifBadge(); } });
  }

  async function boot() {
    const user = await requireAuth();
    if (!user) return new Promise(() => {}); // redirecting
    const [profile, member] = await Promise.all([getProfile(user.id).catch(() => null), ensureMyMemberProfile().catch(() => null)]);
    const isAdmin = profile?.role === 'admin';
    const name = member?.display_name || profile?.first_name || 'Member';

    const pill = document.getElementById('shell-avatar');
    if (pill) { pill.outerHTML = avatarHTML(member || { display_name: name }, 'xs').replace('class="av av-xs"', 'class="av av-xs" id="shell-avatar"'); }
    const sbAv = document.getElementById('shell-sb-avatar');
    if (sbAv) { sbAv.outerHTML = avatarHTML(member || { display_name: name }, 'sm').replace('class="av av-sm"', 'class="av av-sm" id="shell-sb-avatar"'); }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('shell-name', name); set('shell-sb-name', name); set('shell-sb-role', isAdmin ? 'Administrator' : 'Member');
    if (isAdmin) document.getElementById('admin-link')?.classList.remove('hidden');
    hydrateMedia(document);

    refreshMsgBadge(); refreshNotifBadge(); subscribeRealtime(user.id); touchLastSeen();
    return { user, profile, member, isAdmin };
  }

  renderTopnav();
  renderSidebar();
  wireNotifications();
  window.FE = { ready: boot(), setBadge, refreshMsgBadge };
})();
