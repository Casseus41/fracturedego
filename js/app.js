// ═══════════════════════════════════════════════
//   fracturedEgo — Supabase Config v3.0
//   Adds: code allowance, invite requests, login activity,
//         currency rates, expanded badges
// ═══════════════════════════════════════════════

// ── Credentials ────────────────────────────────
const SUPABASE_URL      = 'https://aoxheyrtxygerkqsveaf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFveGhleXJ0eHlnZXJrcXN2ZWFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTYzMTksImV4cCI6MjA5MzA3MjMxOX0.cVqcX9cY_bBWcm1sBGdh21UuQYoT6QWn4tI9ZgKk99Q';

// ── Site URLs ─────────────────────────────────
const SITE        = 'https://fracturedego.org';
const URL_RESET   = 'https://fracturedego.org/pages/reset-password.html';
const URL_CONFIRM = 'https://fracturedego.org/pages/confirm.html';

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
  if (error) throw error;
  // Fire-and-forget login event — don't block on errors
  try { await sb.rpc('log_login_event', { p_user_agent: navigator.userAgent || null, p_ip: null }); } catch (_) {}
  return data;
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
async function refreshAllowance() {
  const { error } = await sb.rpc('refresh_code_allowance');
  if (error) console.warn('refresh_code_allowance:', error.message);
}

// ═══════════════════════════════════════════════
//   REQUESTS (concierge service)
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
//   ACCESS CODES — public flow
// ═══════════════════════════════════════════════
async function redeemAccessCode(code) {
  const { data, error } = await sb.rpc('redeem_access_code', { p_code: code });
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════
//   ACCESS CODES — admin
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
//   CODE REQUESTS — member side
// ═══════════════════════════════════════════════
async function requestCode(notes) {
  const { data, error } = await sb.rpc('request_code', { p_notes: notes || null });
  if (error) throw error;
  return data;
}
async function getMyAssignedCodes() {
  const { data, error } = await sb.rpc('get_my_assigned_codes');
  if (error) throw error;
  return data || [];
}
async function cancelMyCodeRequest(id) {
  const { error } = await sb.from('code_requests').update({ status: 'cancelled', resolved_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   CODE REQUESTS — admin side
// ═══════════════════════════════════════════════
async function getAllCodeRequests() {
  const { data, error } = await sb.from('code_requests')
    .select('*, profiles!code_requests_user_id_fkey(first_name, last_name, email, codes_allowance_total, codes_used_this_year)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function approveCodeRequest(requestId, codeId) {
  const { data, error } = await sb.rpc('assign_code_to_request', { p_request_id: requestId, p_code_id: codeId });
  if (error) throw error;
  return data;
}
async function denyCodeRequest(requestId, reason) {
  const { data, error } = await sb.rpc('deny_code_request', { p_request_id: requestId, p_reason: reason || null });
  if (error) throw error;
  return data;
}
async function adjustMemberAllowance(userId, total) {
  const { error } = await sb.from('profiles').update({ codes_allowance_total: total, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   INVITE REQUESTS — member side
// ═══════════════════════════════════════════════
async function submitInviteRequest({ email, firstName, lastName, relationship, reason }) {
  const user = await getUser(); if (!user) throw new Error('Not authenticated');
  const { error } = await sb.from('invite_requests').insert({
    requester_id: user.id,
    email,
    first_name: firstName,
    last_name: lastName,
    relationship,
    reason,
    status: 'pending',
  });
  if (error) throw error;
}
async function getMyInviteRequests() {
  const user = await getUser(); if (!user) throw new Error('Not authenticated');
  const { data, error } = await sb.from('invite_requests').select('*').eq('requester_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════
//   INVITE REQUESTS — admin side
// ═══════════════════════════════════════════════
async function getAllInviteRequests() {
  const { data, error } = await sb.from('invite_requests')
    .select('*, profiles!invite_requests_requester_id_fkey(first_name, last_name, email)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function setInviteRequestStatus(id, status, extra = {}) {
  const updates = { status, ...extra };
  if (status === 'denied' || status === 'sent' || status === 'approved') updates.resolved_at = new Date().toISOString();
  const { error } = await sb.from('invite_requests').update(updates).eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════
//   LOGIN ACTIVITY (admin)
// ═══════════════════════════════════════════════
async function getAllLoginActivity(limit = 200) {
  const { data, error } = await sb.from('login_activity')
    .select('*, profiles!login_activity_user_id_fkey(first_name, last_name, email)')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
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
//   MEMBERSHIP REQUESTS — public-facing applications
// ═══════════════════════════════════════════════
async function submitMembershipRequest({ firstName, lastName, citizenship, email, phone, lifeQuestion }) {
  const { data, error } = await sb.from('membership_requests').insert({
    first_name:    firstName,
    last_name:     lastName,
    citizenship,
    email,
    phone:         phone || null,
    life_question: lifeQuestion,
  }).select().single();
  if (error) throw error;
  return data;
}
async function getAllMembershipRequests() {
  const { data, error } = await sb.from('membership_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function getMembershipRequestById(id) {
  const { data, error } = await sb.from('membership_requests').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}
async function setMembershipRequestStatus(id, status, adminNotes) {
  const { data: { user } } = await sb.auth.getUser();
  const updates = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user?.id || null,
  };
  if (typeof adminNotes === 'string') updates.admin_notes = adminNotes;
  const { error } = await sb.from('membership_requests').update(updates).eq('id', id);
  if (error) throw error;
}
async function approveMembershipRequest(id, adminNotes) {
  // 1. Mark the request approved
  // 2. Auto-add the applicant to pending_invites so admin can hit Send from
  //    the existing Invitations tab.
  const req = await getMembershipRequestById(id);
  if (!req) throw new Error('Request not found');

  // Check if this email is already in pending_invites
  const { data: existing } = await sb.from('pending_invites').select('id').eq('email', req.email).maybeSingle();
  if (!existing) {
    const { error: invErr } = await sb.from('pending_invites').insert({
      email:      req.email,
      first_name: req.first_name,
      last_name:  req.last_name,
      role:       'member',
      status:     'pending',
    });
    if (invErr) throw invErr;
  }

  await setMembershipRequestStatus(id, 'approved', adminNotes);
}
async function denyMembershipRequest(id, reason) {
  await setMembershipRequestStatus(id, 'denied', reason || null);
}

// ═══════════════════════════════════════════════
//   ADMIN — INVITES (existing flow)
// ═══════════════════════════════════════════════
async function logInvite(email, firstName, lastName, role) {
  const { error } = await sb.from('pending_invites').insert({
    email, first_name: firstName, last_name: lastName, role, status: 'pending'
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
  // Use the Supabase SDK's functions.invoke — it surfaces clear errors when
  // the function is missing, returns non-2xx, or has CORS issues. Raw fetch
  // hides these as "Failed to fetch" which is hard to diagnose.
  const session = await getSession();
  if (!session) throw new Error('Not authenticated');

  const { data, error } = await sb.functions.invoke('send-invite', {
    body: opts,
  });

  if (error) {
    // FunctionsHttpError, FunctionsRelayError, FunctionsFetchError
    // The .context.response may have the actual server response body
    let detail = error.message || 'Unknown error';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body?.error) detail = body.error;
      }
    } catch (_) { /* response body not JSON, keep generic message */ }

    // Friendlier translation for the most common cause
    if (detail === 'Failed to fetch' || /Failed to send a request/.test(detail) || /NetworkError/.test(detail)) {
      detail = "Edge Function 'send-invite' not reachable — check that it's deployed in Supabase (Dashboard → Edge Functions → send-invite).";
    } else if (/non-2xx/i.test(detail) && !data) {
      detail = 'Edge Function returned an error — open browser console (F12) for details, or check Supabase → Edge Functions → send-invite → Logs.';
    }
    throw new Error(detail);
  }

  return data;
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

// ═══════════════════════════════════════════════
//   CURRENCY — wish flow money option
// ═══════════════════════════════════════════════
//   Rates are units-of-FOREIGN per 1 USD.
//   Last refreshed manually: 2026-05-07
const CURRENCY_RATES = {
  USD: 1,        EUR: 0.93,    GBP: 0.79,    CAD: 1.37,
  AUD: 1.52,     JPY: 156,     CHF: 0.88,    MXN: 17.5,
  INR: 84,       BRL: 5.1,     ZAR: 18.4,    CNY: 7.2,
  KRW: 1370,     SGD: 1.35,    HKD: 7.83,    NZD: 1.66,
  SEK: 10.9,     NOK: 11,
};
const CURRENCY_NAMES = {
  USD: 'US Dollar',          EUR: 'Euro',                GBP: 'British Pound',
  CAD: 'Canadian Dollar',    AUD: 'Australian Dollar',   JPY: 'Japanese Yen',
  CHF: 'Swiss Franc',        MXN: 'Mexican Peso',        INR: 'Indian Rupee',
  BRL: 'Brazilian Real',     ZAR: 'South African Rand',  CNY: 'Chinese Yuan',
  KRW: 'South Korean Won',   SGD: 'Singapore Dollar',    HKD: 'Hong Kong Dollar',
  NZD: 'New Zealand Dollar', SEK: 'Swedish Krona',       NOK: 'Norwegian Krone',
};
const USD_CAP = 10000;
function maxAmountInCurrency(code) {
  const r = CURRENCY_RATES[code] || 1;
  const raw = USD_CAP * r;
  if (code === 'KRW' || code === 'JPY') return Math.floor(raw / 1000) * 1000;
  return Math.floor(raw / 100) * 100;
}
function formatCurrencyAmount(amount, code) {
  const n = Number(amount);
  if (!isFinite(n)) return amount;
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  return `${fmt.format(n)} ${code}`;
}

// ═══════════════════════════════════════════════
//   BADGES
// ═══════════════════════════════════════════════
function statusBadge(status) {
  const map = {
    pending:       `<span class="badge badge-amber">Pending</span>`,
    'in-progress': `<span class="badge badge-pink">In Progress</span>`,
    complete:      `<span class="badge badge-green">Complete</span>`,
    new:           `<span class="badge badge-gold">New</span>`,
    reviewed:      `<span class="badge badge-neutral">Reviewed</span>`,
    actioned:      `<span class="badge badge-green">Actioned</span>`,
    approved:      `<span class="badge badge-green">Approved</span>`,
    denied:        `<span class="badge badge-red">Denied</span>`,
    cancelled:     `<span class="badge badge-neutral">Cancelled</span>`,
    sent:          `<span class="badge badge-pink">Sent</span>`,
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