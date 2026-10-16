// ═══════════════════════════════════════════════
//   fractured Ego — Community layer (v4)
//   Depends on app.js (sb, escapeHtml, formatDate, getUser).
//   Data access is always narrowed to the caller where it matters,
//   because admins' RLS lets them read everything.
// ═══════════════════════════════════════════════

const MEDIA_BUCKET = 'social-media';
const REACTIONS = { heart: '❤️', pray: '🙏', spark: '✨', hug: '🫂' };
const REPORT_REASONS = {
  harassment: 'Harassment or bullying',
  unsafe: 'Makes me feel unsafe',
  privacy: 'Shares private information',
  impersonation: 'Impersonation',
  spam: 'Spam or scam',
  other: 'Something else',
};
const MP_FIELDS = 'id, display_name, pronouns, headline, location, bio, interests, avatar_path, created_at, last_seen_at';
const POST_SELECT = 'id, author_id, body, image_path, is_announcement, is_pinned, created_at, edited_at, ' +
  'author:member_profiles!posts_author_id_fkey(id, display_name, avatar_path, headline), post_comments(count)';

const esc = (s) => escapeHtml(s == null ? '' : String(s));

let _myId = null;
async function myId() {
  if (_myId) return _myId;
  const u = await getUser();
  _myId = u ? u.id : null;
  return _myId;
}

// ─── Formatting ────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  if (s < 604800) return Math.round(s / 86400) + 'd';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function fullTime(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
}
function nameInitials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).replace('.', '').toUpperCase() || '?';
}

// ─── Media (private bucket + signed URLs) ──────
const _mediaCache = (() => { try { return JSON.parse(sessionStorage.getItem('fe_media') || '{}'); } catch (_) { return {}; } })();
async function signMedia(paths) {
  const now = Date.now(), out = {}, need = [];
  [...new Set(paths.filter(Boolean))].forEach((p) => {
    const c = _mediaCache[p];
    if (c && c.exp > now + 120000) out[p] = c.url; else need.push(p);
  });
  if (need.length) {
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(need, 3600);
    if (!error && data) {
      data.forEach((d) => {
        if (d.signedUrl && d.path) { _mediaCache[d.path] = { url: d.signedUrl, exp: now + 3600000 }; out[d.path] = d.signedUrl; }
      });
      try { sessionStorage.setItem('fe_media', JSON.stringify(_mediaCache)); } catch (_) {}
    }
  }
  return out;
}
// Fills every [data-avatar] and [data-media] inside root with signed images.
async function hydrateMedia(root = document) {
  const avatars = [...root.querySelectorAll('[data-avatar]:not([data-hydrated])')];
  const media = [...root.querySelectorAll('img[data-media]:not([data-hydrated])')];
  const urls = await signMedia([...avatars.map((e) => e.dataset.avatar), ...media.map((e) => e.dataset.media)]);
  avatars.forEach((el) => {
    const u = urls[el.dataset.avatar]; el.dataset.hydrated = '1';
    if (u) { el.style.backgroundImage = `url("${u}")`; el.classList.add('has-img'); }
  });
  media.forEach((img) => {
    const u = urls[img.dataset.media]; img.dataset.hydrated = '1';
    if (u) img.src = u; else img.closest('.post-media')?.remove();
  });
}
function avatarHTML(profile, size = 'md') {
  const name = profile?.display_name || 'Member';
  const path = profile?.avatar_path;
  return `<span class="av av-${size}"${path ? ` data-avatar="${esc(path)}"` : ''} aria-hidden="true"><span>${esc(nameInitials(name))}</span></span>`;
}

// Re-encodes through a canvas: resizes AND strips EXIF/GPS metadata.
async function prepareImage(file, { maxDim = 1600, square = false, quality = 0.86 } = {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is too large (25 MB max before resizing).');
  const src = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
  let sw = src.naturalWidth, sh = src.naturalHeight, sx = 0, sy = 0;
  if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111114'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Image processing failed.')), 'image/jpeg', quality));
}
async function uploadImage(file, kind = 'post') {
  const uid = await myId(); if (!uid) throw new Error('Not signed in');
  const blob = await prepareImage(file, kind === 'avatar' ? { maxDim: 512, square: true } : { maxDim: 1600 });
  const path = `${uid}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}
async function removeMedia(path) {
  if (!path) return;
  try { await sb.storage.from(MEDIA_BUCKET).remove([path]); } catch (_) {}
}

// ─── Member profiles ───────────────────────────
async function getMemberProfile(id) {
  const { data, error } = await sb.from('member_profiles').select(MP_FIELDS).eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
async function ensureMyMemberProfile() {
  const uid = await myId(); if (!uid) return null;
  let mp = await getMemberProfile(uid);
  if (!mp) {
    await sb.from('member_profiles').insert({ id: uid });
    mp = await getMemberProfile(uid);
  }
  return mp;
}
async function listMembers() {
  const { data, error } = await sb.from('member_profiles').select(MP_FIELDS).order('display_name');
  if (error) throw error; return data || [];
}
async function updateMyMemberProfile(fields) {
  const uid = await myId();
  const { error } = await sb.from('member_profiles').update(fields).eq('id', uid);
  if (error) throw error;
}
async function touchLastSeen() {
  try {
    const k = 'fe_seen_at', last = +localStorage.getItem(k) || 0;
    if (Date.now() - last < 5 * 60000) return;
    localStorage.setItem(k, String(Date.now()));
    await updateMyMemberProfile({ last_seen_at: new Date().toISOString() });
  } catch (_) {}
}

// ─── Feed ──────────────────────────────────────
async function fetchFeed({ before = null, limit = 15, authorId = null, includePinned = false } = {}) {
  let q = sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(limit);
  if (!includePinned) q = q.eq('is_pinned', false);
  if (before) q = q.lt('created_at', before);
  if (authorId) q = q.eq('author_id', authorId);
  const { data, error } = await q; if (error) throw error; return data || [];
}
async function fetchPinned() {
  const { data, error } = await sb.from('posts').select(POST_SELECT).eq('is_pinned', true).order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function fetchPost(id) {
  const { data, error } = await sb.from('posts').select(POST_SELECT).eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
async function createPost({ body, imagePath = null, isAnnouncement = false, isPinned = false }) {
  const uid = await myId();
  const { data, error } = await sb.from('posts').insert({
    author_id: uid, body: body || '', image_path: imagePath, is_announcement: isAnnouncement, is_pinned: isPinned,
  }).select(POST_SELECT).single();
  if (error) throw error; return data;
}
async function updatePost(id, fields) {
  const { error } = await sb.from('posts').update(fields).eq('id', id); if (error) throw error;
}
async function deletePost(id) {
  const { error } = await sb.from('posts').delete().eq('id', id); if (error) throw error;
}
async function fetchReactions(postIds) {
  if (!postIds.length) return {};
  const uid = await myId();
  const { data, error } = await sb.from('post_reactions').select('post_id, user_id, emoji').in('post_id', postIds);
  if (error) throw error;
  const map = {};
  postIds.forEach((id) => { map[id] = { counts: {}, mine: new Set() }; });
  (data || []).forEach((r) => {
    const m = map[r.post_id]; if (!m) return;
    m.counts[r.emoji] = (m.counts[r.emoji] || 0) + 1;
    if (r.user_id === uid) m.mine.add(r.emoji);
  });
  return map;
}
async function setReaction(postId, emoji, on) {
  const uid = await myId();
  const q = on
    ? sb.from('post_reactions').insert({ post_id: postId, user_id: uid, emoji })
    : sb.from('post_reactions').delete().match({ post_id: postId, user_id: uid, emoji });
  const { error } = await q; if (error && error.code !== '23505') throw error;
}
async function fetchComments(postId) {
  const { data, error } = await sb.from('post_comments')
    .select('id, post_id, author_id, body, created_at, edited_at, author:member_profiles!post_comments_author_id_fkey(id, display_name, avatar_path)')
    .eq('post_id', postId).order('created_at');
  if (error) throw error; return data || [];
}
async function addComment(postId, body) {
  const uid = await myId();
  const { data, error } = await sb.from('post_comments').insert({ post_id: postId, author_id: uid, body })
    .select('id, post_id, author_id, body, created_at, edited_at, author:member_profiles!post_comments_author_id_fkey(id, display_name, avatar_path)').single();
  if (error) throw error; return data;
}
async function deleteComment(id) {
  const { error } = await sb.from('post_comments').delete().eq('id', id); if (error) throw error;
}

// ─── Messaging ─────────────────────────────────
async function listConversations() {
  const { data, error } = await sb.rpc('list_my_conversations'); if (error) throw error; return data || [];
}
async function startConversation(otherId) {
  const { data, error } = await sb.rpc('start_conversation', { p_other: otherId });
  if (error) {
    const m = error.message || '';
    if (m.includes('recipient_unavailable')) throw new Error('This member isn’t available for messages right now.');
    if (m.includes('messaging_restricted')) throw new Error('Messaging is currently paused on your account. Contact Sibeth if you think this is a mistake.');
    throw error;
  }
  return data;
}
async function fetchMessages(convId, { before = null, limit = 60 } = {}) {
  let q = sb.from('messages').select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at')
    .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q; if (error) throw error; return (data || []).reverse();
}
async function fetchParticipants(convId) {
  const { data, error } = await sb.from('conversation_participants')
    .select('user_id, last_read_at, member:member_profiles!conversation_participants_user_id_fkey(' + MP_FIELDS + ')')
    .eq('conversation_id', convId);
  if (error) throw error; return data || [];
}
async function sendMessage(convId, body) {
  const uid = await myId();
  const { data, error } = await sb.from('messages').insert({ conversation_id: convId, sender_id: uid, body })
    .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').single();
  if (error) {
    if ((error.message || '').includes('row-level security')) throw new Error('This message couldn’t be sent. The conversation may no longer be available.');
    throw error;
  }
  return data;
}
async function deleteMessage(id) {
  const { error } = await sb.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
async function markConversationRead(convId) {
  const uid = await myId();
  await sb.from('conversation_participants').update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', convId).eq('user_id', uid);
}
async function unreadMessageCount() {
  const { data, error } = await sb.rpc('unread_message_count'); if (error) return 0; return data || 0;
}

// ─── Blocks, reports, restrictions ─────────────
async function listMyBlocks() {
  const uid = await myId();
  const { data, error } = await sb.from('member_blocks').select('blocked_id, created_at').eq('blocker_id', uid);
  if (error) throw error; return data || [];
}
async function blockMember(id) {
  const uid = await myId();
  const { error } = await sb.from('member_blocks').insert({ blocker_id: uid, blocked_id: id });
  if (error && error.code !== '23505') throw error;
}
async function unblockMember(id) {
  const uid = await myId();
  const { error } = await sb.from('member_blocks').delete().match({ blocker_id: uid, blocked_id: id });
  if (error) throw error;
}
async function submitReport({ targetType, targetId, reason, details }) {
  const { error } = await sb.from('reports').insert({ target_type: targetType, target_id: targetId, reason, details: details || null });
  if (error) throw error;
}
async function getMyRestrictions() {
  const uid = await myId();
  const { data } = await sb.from('member_restrictions').select('posting_suspended, messaging_suspended').eq('user_id', uid).maybeSingle();
  return data || { posting_suspended: false, messaging_suspended: false };
}

// ─── Notifications ─────────────────────────────
async function listNotifications(limit = 25) {
  const uid = await myId();
  const { data, error } = await sb.from('notifications')
    .select('id, type, preview, link, read_at, created_at, post_id, actor:member_profiles!notifications_actor_id_fkey(id, display_name, avatar_path)')
    .eq('user_id', uid).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
async function unreadNotificationCount() {
  const uid = await myId();
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null);
  return count || 0;
}
async function markNotificationsRead(ids = null) {
  const uid = await myId();
  let q = sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null);
  if (ids) q = q.in('id', ids);
  await q;
}
function notificationText(n) {
  const who = `<strong>${esc(n.actor?.display_name || 'Someone')}</strong>`;
  switch (n.type) {
    case 'comment':      return { icon: '💬', html: `${who} commented: “${esc(n.preview)}”` };
    case 'reaction':     return { icon: REACTIONS[n.preview] || '❤️', html: `${who} reacted to your post` };
    case 'announcement': return { icon: '📣', html: `<strong>Announcement</strong> · ${esc(n.preview)}` };
    case 'code_ready':   return { icon: '🔑', html: esc(n.preview) };
    case 'code_denied':  return { icon: '🔑', html: esc(n.preview) };
    case 'invite_update':return { icon: '✉️', html: esc(n.preview) };
    case 'request_update':return { icon: '📋', html: esc(n.preview) };
    default:             return { icon: '•', html: esc(n.preview || 'Update') };
  }
}

// ─── Admin data ────────────────────────────────
async function adminListReports(status = 'pending') {
  let q = sb.from('reports').select('*').order('created_at', { ascending: false }).limit(300);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q; if (error) throw error; return data || [];
}
async function adminUpdateReport(id, fields) {
  const uid = await myId();
  const patch = { ...fields };
  if (fields.status && fields.status !== 'pending') { patch.resolved_at = new Date().toISOString(); patch.resolved_by = uid; }
  const { error } = await sb.from('reports').update(patch).eq('id', id); if (error) throw error;
}
async function adminListPosts(limit = 100) {
  const { data, error } = await sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
async function adminListConversations() {
  const { data, error } = await sb.from('conversations')
    .select('id, created_at, last_message_at, conversation_participants(user_id, member:member_profiles!conversation_participants_user_id_fkey(display_name, avatar_path))')
    .order('last_message_at', { ascending: false }).limit(300);
  if (error) throw error; return data || [];
}
async function adminListArchive(limit = 200) {
  const { data, error } = await sb.from('content_archive').select('*').order('archived_at', { ascending: false }).limit(limit);
  if (error) throw error; return data || [];
}
async function adminListRestrictions() {
  const { data, error } = await sb.from('member_restrictions').select('*').order('updated_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function adminSetRestriction(userId, { posting, messaging, reason }) {
  const uid = await myId();
  if (!posting && !messaging) {
    const { error } = await sb.from('member_restrictions').delete().eq('user_id', userId); if (error) throw error; return;
  }
  const { error } = await sb.from('member_restrictions').upsert({
    user_id: userId, posting_suspended: !!posting, messaging_suspended: !!messaging,
    reason: reason || null, updated_at: new Date().toISOString(), updated_by: uid,
  });
  if (error) throw error;
}

// ─── UI primitives: toast + dialog ─────────────
function toast(message, type = 'info') {
  let wrap = document.getElementById('fe-toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'fe-toasts'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = `fe-toast fe-toast-${type}`; t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}
// Returns a Promise resolving to form values (object) or null if cancelled.
function openDialog({ title, eyebrow = '', bodyHTML = '', confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay show';
    ov.innerHTML = `<div class="modal-content fe-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        ${eyebrow ? `<div class="page-eyebrow">${esc(eyebrow)}</div>` : ''}
        <h3 class="fe-dialog-title">${title}</h3>
        <form class="fe-dialog-body">${bodyHTML}
          <div class="fe-dialog-actions">
            <button type="button" class="btn btn-ghost" data-cancel>${esc(cancelLabel)}</button>
            <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
          </div>
        </form></div>`;
    const close = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(null); });
    ov.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    ov.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {}; new FormData(e.target).forEach((v, k) => { vals[k] = v; });
      close(vals);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    (ov.querySelector('select, textarea, input') || ov.querySelector('[type=submit]')).focus();
  });
}
async function uiConfirm(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  const r = await openDialog({ title: esc(title), bodyHTML: `<p class="fe-dialog-text">${esc(message)}</p>`, confirmLabel, danger });
  return r !== null;
}
async function openReportDialog(targetType, targetId, label = 'this') {
  const opts = Object.entries(REPORT_REASONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const vals = await openDialog({
    eyebrow: 'Private report', title: `Report ${esc(label)}`, confirmLabel: 'Send report',
    bodyHTML: `<p class="fe-dialog-text">Reports go only to the fractured Ego admin team. The person you report is never told who reported them.</p>
      <div class="field"><label class="field-label">Reason</label><div class="field-input"><select name="reason" required>${opts}</select></div></div>
      <div class="field"><label class="field-label">Anything we should know? <span class="field-optional">optional</span></label>
      <div class="field-input"><textarea name="details" rows="3" maxlength="1000" placeholder="Context helps us act quickly."></textarea></div></div>`,
  });
  if (!vals) return false;
  try { await submitReport({ targetType, targetId, reason: vals.reason, details: vals.details }); toast('Report sent. Thank you for looking out for the circle.', 'success'); return true; }
  catch (e) { toast(e.message || 'Could not send report.', 'error'); return false; }
}

// ─── Post rendering ────────────────────────────
// ctx: { meId, isAdmin, reactions: {postId:{counts,mine}}, onRemoved(postId) }
function renderPost(p, ctx) {
  const a = p.author || { display_name: 'Former member' };
  const mine = p.author_id === ctx.meId;
  const r = ctx.reactions[p.id] || { counts: {}, mine: new Set() };
  const cc = p.post_comments?.[0]?.count || 0;
  const menu = [];
  if (mine) menu.push(['edit-post', 'Edit post'], ['delete-post', 'Delete post']);
  if (!mine) menu.push(['report-post', 'Report post']);
  if (!mine && a.id) menu.push(['message-author', `Message ${a.display_name}`]);
  if (ctx.isAdmin) { menu.push([p.is_pinned ? 'unpin-post' : 'pin-post', p.is_pinned ? 'Unpin' : 'Pin to top']); if (!mine) menu.push(['delete-post', 'Remove (admin)']); }
  return `<article class="post-card${p.is_announcement ? ' is-announcement' : ''}" id="post-${p.id}" data-post-id="${p.id}" data-author-id="${esc(p.author_id)}" data-author-name="${esc(a.display_name)}">
    ${p.is_announcement || p.is_pinned ? `<div class="post-flags">${p.is_announcement ? '<span class="post-flag">📣 Announcement</span>' : ''}${p.is_pinned ? '<span class="post-flag">📌 Pinned</span>' : ''}</div>` : ''}
    <header class="post-head">
      <a ${a.id ? `href="profile.html?id=${a.id}"` : ''} class="post-author">${avatarHTML(a, 'md')}
        <span class="post-author-text"><span class="post-author-name">${esc(a.display_name)}</span>
        <span class="post-author-meta">${a.headline ? esc(a.headline) + ' · ' : ''}<time datetime="${p.created_at}" title="${esc(fullTime(p.created_at))}">${timeAgo(p.created_at)}</time>${p.edited_at ? ' · edited' : ''}</span></span></a>
      <div class="menu-wrap"><button type="button" class="icon-btn" data-action="menu" aria-label="Post options">⋯</button>
        <div class="menu-pop" data-menu hidden>${menu.map(([act, label]) => `<button type="button" data-action="${act}">${esc(label)}</button>`).join('')}</div></div>
    </header>
    ${p.body ? `<div class="post-body" data-body>${linkify(esc(p.body))}</div>` : ''}
    ${p.image_path ? `<div class="post-media"><img data-media="${esc(p.image_path)}" alt="Image shared by ${esc(a.display_name)}" loading="lazy"></div>` : ''}
    <footer class="post-actions">
      <div class="reaction-row">${Object.entries(REACTIONS).map(([k, e]) =>
        `<button type="button" class="react-btn${r.mine.has(k) ? ' on' : ''}" data-action="react" data-emoji="${k}" aria-pressed="${r.mine.has(k)}">${e}<span>${r.counts[k] || ''}</span></button>`).join('')}</div>
      <button type="button" class="comment-toggle" data-action="toggle-comments">💬 <span data-cc>${cc}</span></button>
    </footer>
    <section class="comments" data-comments hidden>
      <div class="comment-list" data-comment-list></div>
      <form class="comment-form" data-comment-form>
        <input type="text" name="body" maxlength="2000" placeholder="Write a kind reply…" autocomplete="off" aria-label="Reply">
        <button type="submit" class="btn btn-primary btn-sm">Reply</button>
      </form>
    </section>
  </article>`;
}
function renderComment(c, ctx, postAuthorId) {
  const a = c.author || { display_name: 'Former member' };
  const canDelete = c.author_id === ctx.meId || postAuthorId === ctx.meId || ctx.isAdmin;
  return `<div class="comment" data-comment-id="${c.id}">
    ${avatarHTML(a, 'sm')}
    <div class="comment-main"><div class="comment-bubble">
      <a ${a.id ? `href="profile.html?id=${a.id}"` : ''} class="comment-author">${esc(a.display_name)}</a>
      <div class="comment-text">${linkify(esc(c.body))}</div></div>
      <div class="comment-meta"><time title="${esc(fullTime(c.created_at))}">${timeAgo(c.created_at)}</time>
        ${canDelete ? `<button type="button" data-action="delete-comment">Delete</button>` : ''}
        ${c.author_id !== ctx.meId ? `<button type="button" data-action="report-comment">Report</button>` : ''}</div>
    </div></div>`;
}
async function renderPostsInto(container, posts, ctx, { append = false } = {}) {
  const map = await fetchReactions(posts.map((p) => p.id));
  Object.assign(ctx.reactions, map);
  const html = posts.map((p) => renderPost(p, ctx)).join('');
  if (append) container.insertAdjacentHTML('beforeend', html); else container.innerHTML = html;
  hydrateMedia(container);
}

// One delegated handler per container; idempotent.
function bindPostInteractions(container, ctx) {
  if (container.dataset.bound) return; container.dataset.bound = '1';

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn || !container.contains(btn)) return;
    const card = btn.closest('.post-card'); const postId = card?.dataset.postId;
    const act = btn.dataset.action;
    if (act !== 'menu') card?.querySelector('[data-menu]')?.setAttribute('hidden', '');

    try {
      if (act === 'menu') {
        const pop = card.querySelector('[data-menu]'); const open = pop.hasAttribute('hidden');
        document.querySelectorAll('[data-menu]').forEach((m) => m.setAttribute('hidden', ''));
        if (open) pop.removeAttribute('hidden');
        e.stopPropagation();
      } else if (act === 'react') {
        const on = !btn.classList.contains('on'); const span = btn.querySelector('span');
        btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on);
        const n = Math.max(0, (+span.textContent || 0) + (on ? 1 : -1)); span.textContent = n || '';
        try { await setReaction(postId, btn.dataset.emoji, on); }
        catch (err) { btn.classList.toggle('on', !on); span.textContent = Math.max(0, n + (on ? -1 : 1)) || ''; throw err; }
      } else if (act === 'toggle-comments') {
        const sec = card.querySelector('[data-comments]');
        if (sec.hasAttribute('hidden')) {
          sec.removeAttribute('hidden');
          const list = sec.querySelector('[data-comment-list]');
          list.innerHTML = '<div class="muted-line">Loading…</div>';
          const comments = await fetchComments(postId);
          list.innerHTML = comments.map((c) => renderComment(c, ctx, card.dataset.authorId)).join('') || '<div class="muted-line">No replies yet.</div>';
          hydrateMedia(list);
          sec.querySelector('input').focus();
        } else sec.setAttribute('hidden', '');
      } else if (act === 'edit-post') {
        startInlineEdit(card);
      } else if (act === 'delete-post') {
        if (!(await uiConfirm('Delete this post?', 'It will be removed from the feed for everyone.', { confirmLabel: 'Delete', danger: true }))) return;
        await deletePost(postId); card.remove(); ctx.onRemoved?.(postId); toast('Post deleted.');
      } else if (act === 'pin-post' || act === 'unpin-post') {
        await updatePost(postId, { is_pinned: act === 'pin-post' }); toast(act === 'pin-post' ? 'Pinned to top.' : 'Unpinned.', 'success'); ctx.onPinChange?.();
      } else if (act === 'report-post') {
        await openReportDialog('post', postId, 'this post');
      } else if (act === 'message-author') {
        const conv = await startConversation(card.dataset.authorId); location.href = `messages.html?c=${conv}`;
      } else if (act === 'delete-comment') {
        const row = btn.closest('.comment');
        if (!(await uiConfirm('Delete this reply?', 'This cannot be undone.', { confirmLabel: 'Delete', danger: true }))) return;
        await deleteComment(row.dataset.commentId); row.remove();
        const cc = card.querySelector('[data-cc]'); cc.textContent = Math.max(0, (+cc.textContent || 1) - 1);
      } else if (act === 'report-comment') {
        await openReportDialog('comment', btn.closest('.comment').dataset.commentId, 'this reply');
      }
    } catch (err) { console.error(err); toast(err.message || 'Something went wrong.', 'error'); }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-comment-form]'); if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input'); const body = input.value.trim(); if (!body) return;
    const card = form.closest('.post-card'); const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const c = await addComment(card.dataset.postId, body);
      const list = card.querySelector('[data-comment-list]');
      list.querySelector('.muted-line')?.remove();
      list.insertAdjacentHTML('beforeend', renderComment(c, ctx, card.dataset.authorId));
      hydrateMedia(list); input.value = '';
      const cc = card.querySelector('[data-cc]'); cc.textContent = (+cc.textContent || 0) + 1;
    } catch (err) {
      toast((err.message || '').includes('row-level') ? 'Replies are paused on your account right now.' : (err.message || 'Could not reply.'), 'error');
    }
    btn.disabled = false;
  });
}
function startInlineEdit(card) {
  const bodyEl = card.querySelector('[data-body]');
  const original = bodyEl ? bodyEl.innerText : '';
  const wrap = document.createElement('div'); wrap.className = 'inline-edit';
  wrap.innerHTML = `<textarea maxlength="4000" rows="4">${esc(original)}</textarea>
    <div class="inline-edit-actions"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-s>Save</button></div>`;
  (bodyEl || card.querySelector('.post-head')).after(wrap); if (bodyEl) bodyEl.hidden = true;
  wrap.querySelector('textarea').focus();
  wrap.querySelector('[data-x]').onclick = () => { wrap.remove(); if (bodyEl) bodyEl.hidden = false; };
  wrap.querySelector('[data-s]').onclick = async () => {
    const v = wrap.querySelector('textarea').value.trim();
    if (!v && !card.querySelector('.post-media')) { toast('A post needs some text or an image.', 'error'); return; }
    try {
      await updatePost(card.dataset.postId, { body: v });
      let b = bodyEl; if (!b) { b = document.createElement('div'); b.className = 'post-body'; b.dataset.body = ''; wrap.before(b); }
      b.innerHTML = linkify(esc(v)); b.hidden = false; wrap.remove();
      const meta = card.querySelector('.post-author-meta'); if (meta && !meta.textContent.includes('edited')) meta.insertAdjacentText('beforeend', ' · edited');
      toast('Post updated.', 'success');
    } catch (err) { toast(err.message || 'Could not save.', 'error'); }
  };
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) document.querySelectorAll('[data-menu]').forEach((m) => m.setAttribute('hidden', ''));
});
