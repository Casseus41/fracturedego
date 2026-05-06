// ═══════════════════════════════════════════════
//   fractureD Ego — Supabase Config v2.2
//   Adds: atomic access code redemption + admin
// ═══════════════════════════════════════════════

// ── YOUR CREDENTIALS — fill these in ──────────
const SUPABASE_URL      = 'https://aoxheyrtxygerkqsveaf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFveGhleXJ0eHlnZXJrcXN2ZWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTYzMTksImV4cCI6MjA5MzA3MjMxOX0.cVqcX9cY_bBWcm1sBGdh21UuQYoT6QWn4tI9ZgKk99Q';

// ── Site URLs (hardcoded for reliability) ──────
const SITE              = 'https://fracturedego.org';
const URL_RESET         = 'https://fracturedego.org/pages/reset-password.html';
const URL_CONFIRM       = 'https://fracturedego.org/pages/confirm.html';

// ── Init ──────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════
//   AUTH
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
  if (error) throw error; return data;
}
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'https://fracturedego.org/pages/login.html';
}
async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: URL_RESET });
  if (error) throw error;
}
async function updatePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

async function requireAuth() {
  const user = await getUser();
  if (!user) { window.location.href = 'https://fracturedego.org/pages/login.html'; return null; }
  return user;
}
async function requireAdmin() {
  const user = await requireAuth(); if (!user) return null;
  const profile = await getProfile(user.id);
  if (!profile || profile.role !== 'admin') {
    window.location.href = 'https://fracturedego.org/pages/dashboard.html'; return null;
  }
  return { user, profile };
}
async function redirectIfAuthed() {
  const user = await getUser();
  if (user) window.location.href = 'https://fracturedego.org/pages/dashboard.html';
}

// ═══════════════════════════════════════════════
//   PROFILES
// ═══════════════════════════════════════════════
async function getProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error; return data;
}
async function updateProfile(updates) {
  const user = await getUser(); if (!user) throw new Error('Not authenticated');
  const { error } = await sb.from('profiles').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   REQUESTS
// ═══════════════════════════════════════════════
async function submitRequest(serviceType, formData) {
  const user = await getUser(); if (!user) throw new Error('Not authenticated');
  const { error } = await sb.from('requests').insert({
    user_id: user.id, service_type: serviceType, form_data: formData, status: 'pending'
  });
  if (error) throw error;
}
async function getMyRequests() {
  const user = await getUser(); if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb.from('requests').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function getAllRequests() {
  const { data, error } = await sb.from('requests').select('*, profiles(first_name, last_name, email, phone, contact_pref)').order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function getRequestById(id) {
  const { data, error } = await sb.from('requests').select('*, profiles(first_name, last_name, email, phone, contact_pref)').eq('id', id).single();
  if (error) throw error; return data;
}
async function setRequestStatus(id, status) {
  const { error } = await sb.from('requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
async function setRequestNotes(id, notes) {
  const { error } = await sb.from('requests').update({ admin_notes: notes, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   ACCESS CODES (public flow)
// ═══════════════════════════════════════════════

// Atomically validate and consume an access code.
// Returns { success: true, session_id, code_type } on success,
// or { success: false, reason } on failure.
async function redeemAccessCode(code) {
  const { data, error } = await sb.rpc('redeem_access_code', { p_code: code });
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════
//   ACCESS CODES (admin)
// ═══════════════════════════════════════════════
async function getAllAccessCodes() {
  const { data, error } = await sb.from('access_codes').select('*').order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}

async function generateBulkCodes(count, codeType, notes) {
  const { data, error } = await sb.rpc('bulk_generate_codes', {
    p_count: count, p_type: codeType, p_notes: notes
  });
  if (error) throw error; return data || [];
}

async function addManualCode(code, codeType, notes) {
  const { error } = await sb.from('access_codes').insert({
    code, code_type: codeType, status: 'unused', notes
  });
  if (error) throw error;
}

async function setAccessCodeStatus(id, status) {
  const updates = { status };
  if (status === 'unused') {
    updates.used_at = null;
    updates.used_session = null;
  }
  const { error } = await sb.from('access_codes').update(updates).eq('id', id);
  if (error) throw error;
}

async function deleteAccessCode(id) {
  const { error } = await sb.from('access_codes').delete().eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   WISHES
// ═══════════════════════════════════════════════
async function submitWish(wishData) {
  const { error } = await sb.from('wishes').insert(wishData); if (error) throw error;
}
async function getAllWishes() {
  const { data, error } = await sb.from('wishes').select('*').order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function getWishById(id) {
  const { data, error } = await sb.from('wishes').select('*').eq('id', id).single();
  if (error) throw error; return data;
}
async function setWishStatus(id, status) {
  const { error } = await sb.from('wishes').update({ status }).eq('id', id);
  if (error) throw error;
}
async function setWishNotes(id, notes) {
  const { error } = await sb.from('wishes').update({ admin_notes: notes }).eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   ADMIN — MEMBERS
// ═══════════════════════════════════════════════
async function getAllProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function setMemberStatus(userId, status) {
  const { error } = await sb.from('profiles').update({ status }).eq('id', userId);
  if (error) throw error;
}
async function setMemberRole(userId, role) {
  const { error } = await sb.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   ADMIN — INVITES
// ═══════════════════════════════════════════════
async function logInvite(email, firstName, lastName, role) {
  const { error } = await sb.from('pending_invites').insert({
    email, first_name: firstName, last_name: lastName, role, accepted: false
  });
  if (error) throw error;
}
async function getPendingInvites() {
  const { data, error } = await sb.from('pending_invites').select('*').order('invited_at', { ascending: false });
  if (error) throw error; return data || [];
}
async function deletePendingInvite(id) {
  const { error } = await sb.from('pending_invites').delete().eq('id', id);
  if (error) throw error;
}
async function sendInvites(opts = {}) {
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(opts),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to send invites');
  return result;
}

// ═══════════════════════════════════════════════
//   UI HELPERS
// ═══════════════════════════════════════════════
function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId); if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message; el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
function hideAlert(containerId) {
  const el = document.getElementById(containerId); if (el) el.classList.add('hidden');
}
function setLoading(btnId, loading, label = 'Submit') {
  const btn = document.getElementById(btnId); if (!btn) return;
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
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[m]);
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

const OPTION_MAP = {
  money:      { icon: '💰', label: 'Financial Assistance' },
  relocation: { icon: '🏡', label: 'Relocation Service' },
  transfer:   { icon: '🔄', label: 'Transfer to Another' },
};

function statusBadge(status) {
  const map = {
    pending:       `<span class="badge badge-amber">Pending</span>`,
    'in-progress': `<span class="badge badge-pink">In Progress</span>`,
    complete:      `<span class="badge badge-green">Complete</span>`,
    new:           `<span class="badge badge-gold">New</span>`,
    reviewed:      `<span class="badge badge-neutral">Reviewed</span>`,
    actioned:      `<span class="badge badge-green">Actioned</span>`,
  };
  return map[status] || `<span class="badge badge-neutral">${status}</span>`;
}
function roleBadge(role) {
  return role === 'admin' ? `<span class="badge badge-pink">Admin</span>` : `<span class="badge badge-neutral">Member</span>`;
}
function memberStatusBadge(status) {
  return status === 'inactive' ? `<span class="badge badge-red">Inactive</span>` : `<span class="badge badge-green">Active</span>`;
}
function inviteBadge(accepted) {
  return accepted ? `<span class="badge badge-green">Sent</span>` : `<span class="badge badge-amber">Pending</span>`;
}
function codeStatusBadge(status) {
  const map = {
    unused:  `<span class="badge badge-green">Unused</span>`,
    used:    `<span class="badge badge-neutral">Used</span>`,
    revoked: `<span class="badge badge-red">Revoked</span>`,
    expired: `<span class="badge badge-amber">Expired</span>`,
  };
  return map[status] || `<span class="badge badge-neutral">${status}</span>`;
}
