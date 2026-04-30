// ═══════════════════════════════════════════
//   fractureD Ego — Supabase Config & Auth
//   Version: 1.0
// ═══════════════════════════════════════════

// ── STEP 1: Paste your Supabase credentials here ──
// Get these from: supabase.com → Your Project → Settings → API
const SUPABASE_URL = 'YOUR_SUPABASE_URL';       // e.g. https://abcdefgh.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // long string starting with eyJ...

// ── Site domain (hardcoded for reliability) ──
const SITE_URL = 'https://fracturedego.org';
const RESET_URL = 'https://fracturedego.org/pages/reset-password.html';
const CONFIRM_URL = 'https://fracturedego.org/pages/confirm.html';

// ── Site domain (used for reference) ──
// Your live site: https://fracturedego.org
// Supabase Site URL should be: https://fracturedego.org
// Supabase Redirect URLs should include:
//   https://fracturedego.org/pages/confirm.html
//   https://fracturedego.org/pages/reset-password.html

// ── Initialize Supabase client ──
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Auth helpers ────────────────────────────────────

/**
 * Sign in a user with email + password
 */
async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Sign out current user
 */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = '/index.html';
}

/**
 * Get the currently logged-in user
 */
async function getCurrentUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/**
 * Get the current user's profile from the profiles table
 */
async function getUserProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Protect a page — redirect to login if not authenticated
 * Call this at the top of any protected page
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  return user;
}

/**
 * Protect a page — require admin role
 */
async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.id);
  if (profile.role !== 'admin') {
    window.location.href = '/pages/dashboard.html';
    return null;
  }
  return { user, profile };
}

/**
 * Submit a concierge service request
 */
async function submitServiceRequest(serviceType, formData) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await sb
    .from('requests')
    .insert({
      user_id: user.id,
      service_type: serviceType,
      form_data: formData,
      status: 'pending',
      created_at: new Date().toISOString()
    });
  if (error) throw error;
  return data;
}

/**
 * Get all requests for the current user
 */
async function getUserRequests() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await sb
    .from('requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Submit a wish (access code users)
 */
async function submitWish(wishData) {
  const { data, error } = await sb
    .from('wishes')
    .insert({
      name: wishData.name || 'Anonymous',
      contact: wishData.contact,
      request: wishData.request,
      urgency: wishData.urgency,
      access_code: wishData.code,
      created_at: new Date().toISOString()
    });
  if (error) throw error;
  return data;
}

/**
 * Update the current user's profile
 */
async function updateProfile(updates) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await sb
    .from('profiles')
    .update(updates)
    .eq('id', user.id);
  if (error) throw error;
  return data;
}

/**
 * Change password
 */
async function changePassword(newPassword) {
  const { data, error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

// ── Admin functions ──────────────────────────────────

/**
 * Get all users (admin only)
 */
async function getAllUsers() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Get all requests (admin only)
 */
async function getAllRequests() {
  const { data, error } = await sb
    .from('requests')
    .select('*, profiles(first_name, last_name, email)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Get all wishes (admin only)
 */
async function getAllWishes() {
  const { data, error } = await sb
    .from('wishes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Update a request status (admin only)
 */
async function updateRequestStatus(requestId, status) {
  const { data, error } = await sb
    .from('requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
  return data;
}

/**
 * Invite a new member (admin only)
 * Note: Supabase sends the invitation email automatically
 */
async function inviteMember(email, firstName, lastName, role = 'member') {
  // Create auth invite via Supabase admin (requires service role — use edge function in production)
  // For now this inserts a pending profile record
  const { data, error } = await sb
    .from('pending_invites')
    .insert({ email, first_name: firstName, last_name: lastName, role });
  if (error) throw error;
  return data;
}

/**
 * Deactivate a member account (admin only)
 */
async function deactivateMember(userId) {
  const { data, error } = await sb
    .from('profiles')
    .update({ status: 'inactive' })
    .eq('id', userId);
  if (error) throw error;
  return data;
}

// ── Notification preferences ─────────────────────────

async function updateNotificationPrefs(prefs) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await sb
    .from('profiles')
    .update({ notification_prefs: prefs })
    .eq('id', user.id);
  if (error) throw error;
  return data;
}

// ── Format helpers ───────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatServiceType(type) {
  const map = {
    travel: '✈️ Travel & Relocation',
    security: '🛡️ Security & Protection',
    legal: '⚖️ Legal Assistance',
    medical: '🏥 Medical & Wellness',
    housing: '🏡 Housing & Lodging',
    finance: '💳 Financial Services',
    transport: '🚗 Transport & Logistics',
    lifestyle: '✨ Lifestyle & Personal',
    emergency: '🚨 Emergency Services',
  };
  return map[type] || type;
}

function statusBadge(status) {
  const map = {
    pending: '<span class="h-status pending">Pending</span>',
    'in-progress': '<span class="h-status review">In Progress</span>',
    complete: '<span class="h-status complete">Complete</span>',
  };
  return map[status] || `<span class="h-status">${status}</span>`;
}
