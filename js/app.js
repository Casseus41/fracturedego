// ═══════════════════════════════════════════════
//   fractureD Ego — Supabase Config v2.0
//   Site: https://fracturedego.org
// ═══════════════════════════════════════════════

// ── YOUR CREDENTIALS — fill these in ──────────
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// ── Site URLs (hardcoded for reliability) ──────
const SITE              = 'https://fracturedego.org';
const URL_RESET         = 'https://fracturedego.org/pages/reset-password.html';
const URL_CONFIRM       = 'https://fracturedego.org/pages/confirm.html';

// ── Init ──────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════
//   AUTH HELPERS
// ═══════════════════════════════════════════════

async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'https://fracturedego.org/pages/login.html';
}

async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: URL_RESET
  });
  if (error) throw error;
}

async function updatePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// ── Route guards ───────────────────────────────

async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = 'https://fracturedego.org/pages/login.html';
    return null;
  }
  return user;
}

async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getProfile(user.id);
  if (!profile || profile.role !== 'admin') {
    window.location.href = 'https://fracturedego.org/pages/dashboard.html';
    return null;
  }
  return { user, profile };
}

async function redirectIfAuthed() {
  const user = await getUser();
  if (user) window.location.href = 'https://fracturedego.org/pages/dashboard.html';
}

// ═══════════════════════════════════════════════
//   PROFILE HELPERS
// ═══════════════════════════════════════════════

async function getProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

async function updateProfile(updates) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   REQUEST HELPERS
// ═══════════════════════════════════════════════

async function submitRequest(serviceType, formData) {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await sb.from('requests').insert({
    user_id: user.id,
    service_type: serviceType,
    form_data: formData,
    status: 'pending'
  });
  if (error) throw error;
}

async function getMyRequests() {
  const user = await getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb
    .from('requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getAllRequests() {
  const { data, error } = await sb
    .from('requests')
    .select('*, profiles(first_name, last_name, email)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function setRequestStatus(id, status) {
  const { error } = await sb
    .from('requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   WISH HELPERS
// ═══════════════════════════════════════════════

async function submitWish(wishData) {
  const { error } = await sb.from('wishes').insert(wishData);
  if (error) throw error;
}

async function getAllWishes() {
  const { data, error } = await sb
    .from('wishes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════
//   ADMIN HELPERS
// ═══════════════════════════════════════════════

async function getAllProfiles() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function setMemberStatus(userId, status) {
  const { error } = await sb
    .from('profiles')
    .update({ status })
    .eq('id', userId);
  if (error) throw error;
}

async function setMemberRole(userId, role) {
  const { error } = await sb
    .from('profiles')
    .update({ role })
    .eq('id', userId);
  if (error) throw error;
}

async function logInvite(email, firstName, lastName, role) {
  const { error } = await sb.from('pending_invites').insert({
    email, first_name: firstName, last_name: lastName, role
  });
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   UI HELPERS
// ═══════════════════════════════════════════════

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}

function hideAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.classList.add('hidden');
}

function setLoading(btnId, loading, label = 'Submit') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : label;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function initials(firstName, lastName) {
  return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || '?';
}

const SERVICE_MAP = {
  travel:    { icon: '✈️', label: 'Travel & Relocation' },
  security:  { icon: '🛡️', label: 'Security & Protection' },
  legal:     { icon: '⚖️', label: 'Legal Assistance' },
  medical:   { icon: '🏥', label: 'Medical & Wellness' },
  housing:   { icon: '🏡', label: 'Housing & Lodging' },
  finance:   { icon: '💳', label: 'Financial Services' },
  transport: { icon: '🚗', label: 'Transport & Logistics' },
  lifestyle: { icon: '✨', label: 'Lifestyle & Personal' },
  emergency: { icon: '🚨', label: 'Emergency Services' },
};

function statusBadge(status) {
  const map = {
    pending:     `<span class="badge badge-amber">Pending</span>`,
    'in-progress': `<span class="badge badge-pink">In Progress</span>`,
    complete:    `<span class="badge badge-green">Complete</span>`,
    new:         `<span class="badge badge-gold">New</span>`,
    reviewed:    `<span class="badge badge-neutral">Reviewed</span>`,
  };
  return map[status] || `<span class="badge badge-neutral">${status}</span>`;
}

function roleBadge(role) {
  return role === 'admin'
    ? `<span class="badge badge-pink">Admin</span>`
    : `<span class="badge badge-neutral">Member</span>`;
}

function memberStatusBadge(status) {
  return status === 'inactive'
    ? `<span class="badge badge-red">Inactive</span>`
    : `<span class="badge badge-green">Active</span>`;
}

// Shared sidebar active state
function setActiveSidebarLink(href) {
  document.querySelectorAll('.sidebar-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('href') === href || l.dataset.panel === href);
  });
}

// Tab switcher
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + target);
      if (panel) panel.classList.add('active');
    });
  });
}
