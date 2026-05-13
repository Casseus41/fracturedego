# fracturedEgo — Project Notes & Session Log

> **Purpose of this file.** Living memory for the project. Every architectural decision, standing instruction from Cass, and major change made by Claude is logged here so future sessions don't lose context. **Read this first** at the start of any new session.

---

## 1. Project Overview

**Site:** [fracturedego.org](https://fracturedego.org) — a private, invitation-only concierge network. Members can request services across nine categories. Members can also issue one-time access codes to outsiders, who use them to request financial assistance, a relocation, or to pass the opportunity to a third party.

**Owner:** Cass — has full ownership and decision authority. All architectural and design choices flow through Cass.

**Tone & feel.** Exclusive. Modern. Discreet. Quietly emotional. Type-driven (Cormorant Garamond italic for headings; Inter for body). Background near-black, accent sky-pink, status gold. The site should never feel corporate, ad-driven, or generic.

---

## 2. Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Static HTML / vanilla JS / hand-rolled CSS (no framework) |
| Hosting | GitHub Pages |
| Domain / DNS | Porkbun |
| Backend / DB / Auth | Supabase (Postgres + RLS + Auth) |
| Email | Resend (configured as Supabase SMTP provider) |
| Edge Functions | Supabase Edge Functions (Deno) — `send-invite` |

**Live credentials in `js/app.js`:**
- `SUPABASE_URL` = `https://aoxheyrtxygerkqsveaf.supabase.co`
- Anon key embedded (safe — protected by RLS)
- `SITE` = `https://fracturedego.org`

---

## 3. Design System (Standing Rules)

**Wordmark.** "fractured Ego" — all lowercase, **white**, except the capital **E** in pink. Logo SVG sits LEFT of the wordmark in nav (`brand-logo` class, ~32px) and on auth pages (~28px). The hero on the landing page has a bigger centered logo (`mid-logo` class).

**Palette (CSS variables in `css/styles.css`):**
- `--bg` `#0c0c0e`, `--bg-2` `#111114`, `--bg-3` `#17171b`, `--bg-4` `#1e1e24`
- `--text` `#f0ede8`, dimmed variants `--text-2/3/4`
- `--pink` `#ffb6c1` (primary accent), `--gold` `#c9a96e` (status), `--green/amber/red` for state
- `--border` `rgba(255,255,255,0.06)`, `--border-pink` for accent borders
- Radii: `--radius-sm/md/lg/xl/full`

**Type.** Cormorant Garamond for headings (italic `<em>` for the pink emphasis word). Inter for everything else. Courier New mono for codes.

**Layout.** Fixed top nav (`--nav-h` 64px). Authenticated pages have a left sidebar (`--sidebar-w` 256px) with sections + heading labels. Mobile collapses sidebar to a horizontal scrollable bar.

**Components in CSS.** `.btn` variants (primary/secondary/ghost), `.alert`, `.badge`, `.field` form rows, `.welcome-banner`, `.stat-card`, `.service-tile`, `.data-table`, `.tabs`/`.tab-btn`/`.tab-panel`, `.empty-state`.

---

## 4. Database Schema

### Pre-existing tables (v2, already deployed)

- **`profiles`** — extends `auth.users`. Cols: `id`, `email`, `first_name`, `last_name`, `phone`, `contact_pref`, `role` ('member' | 'admin'), `status` ('active' | 'inactive'), `notification_prefs jsonb`, `created_at`, `updated_at`. Row created via `handle_new_user()` trigger on `auth.users` insert.
- **`requests`** — member service requests. Cols: `id`, `user_id`, `service_type`, `form_data jsonb`, `status` ('pending' | 'in-progress' | 'complete'), `admin_notes`, timestamps.
- **`wishes`** — submissions from access-code redeemers. Cols: `id`, `name`, `contact`, `request`, `urgency`, `access_code`, `status`, `admin_notes`, `option_chosen` ('money' | 'relocation' | 'transfer'), `option_data jsonb`, `session_id`, `created_at`.
- **`access_codes`** — one-time-use codes. Cols: `id`, `code` (unique), `code_type` ('4-digit' | '10-digit'), `status` ('unused' | 'used' | 'revoked' | 'expired'), `used_at`, `used_session`, `notes`, `created_by`, `created_at`.
- **`pending_invites`** — admin-initiated invite log. Cols: `id`, `email`, `first_name`, `last_name`, `role`, `accepted`, `sent_at`, `invited_at`.

### New tables added in v3 (this session — see `supabase/migration-v3.sql`)

- **`code_requests`** — members requesting access codes from their yearly allowance.
- **`invite_requests`** — members asking admin to send an invite to a specific person.
- **`login_activity`** — audit log of member sign-ins (timestamp, user_id, IP via header, user agent).
- New columns added to `profiles`: `codes_allowance_total int default 2`, `codes_allowance_year int`, `codes_used_this_year int default 0`.

### Pre-existing functions

- `redeem_access_code(p_code)` — atomic validate+consume. Returns `{success, session_id, code_type}` or `{success:false, reason}`.
- `bulk_generate_codes(count, type, notes)`, `generate_4digit_code()`, `generate_10digit_code()`
- `is_admin()` — security definer helper used inside RLS policies (avoids recursion).
- `handle_new_user()` trigger.

### New functions added in v3

- `refresh_code_allowance()` — resets `codes_used_this_year` when the year rolls over.
- `request_code(p_notes)` — member submits a request for one of their allowance codes.
- `assign_code_to_request(p_request_id, p_code_id)` — admin assigns a specific access code to a member's pending request, marks request approved, increments `codes_used_this_year`.
- `deny_code_request(p_request_id, p_reason)` — admin denies, doesn't count against allowance.
- `get_my_assigned_codes()` — returns this member's assigned codes (with the actual code value joined in).
- `log_login_event(p_user_agent, p_ip)` — called from client on successful login.

### Edge Functions

- **`send-invite`** — calls `supabase.auth.admin.inviteUserByEmail`. Deployed via Supabase dashboard. Email templates set with redirect URLs. Site URL: `https://fracturedego.org`. Redirect whitelist includes `confirm.html` and `reset-password.html`.

---

## 5. Current Page Inventory

### Public
- `index.html` — landing. Hero + two entry cards (Member Login / Access Code).
- `pages/access-info.html` — explainer for code holders. Three options outlined.
- `pages/access.html` — code entry box (4-digit or 10-digit).
- `pages/access-confirm.html` — forceful confirmation step before wish form.
- `pages/wish.html` — the final submission form (money / relocation / transfer).

### Auth
- `pages/login.html`, `pages/forgot-password.html`, `pages/reset-password.html`, `pages/confirm.html`

### Member (authenticated)
- `pages/dashboard.html` — overview hub.
- `pages/requests.html` — list of my requests.
- `pages/account.html` — profile / preferences.
- **NEW v3:** `pages/request.html` — single dynamic concierge request form (replaces all 9 `service-*.html` files).
- **NEW v3:** `pages/my-codes.html` — request and view my access-code allowance.
- **NEW v3:** `pages/invite-request.html` — request admin to send an invite.

### Admin
- `pages/admin.html` — all administrative views (tabs).

### Removed in v3
- `pages/service-travel.html`, `service-security.html`, `service-legal.html`, `service-medical.html`, `service-housing.html`, `service-finance.html`, `service-transport.html`, `service-lifestyle.html`, `service-emergency.html` — all consolidated into the new `pages/request.html`.

---

## 6. Standing Instructions From Cass

These are durable preferences. Honor them across every change unless Cass updates them.

1. **Workflow.** Cass uploads the current deployed site as a zip → I edit files in `/home/claude/site/fracturedego/` → I always return a **full zip** of the entire site at `/mnt/user-data/outputs/fracturedego.zip`. The `.git` folder is excluded. Cass replaces the deployed site wholesale.
2. **Be thorough and creative.** Take the time needed. Don't ask permission for incremental decisions; make confident choices and surface them clearly.
3. **Keep it tasteful.** This is a private, emotionally serious space. No corporate bombast, no marketing speak, no emoji-spam.
4. **Privacy is sacred.** Access codes are one-time use and atomically consumed. Member data stays under RLS. No PII in URLs or query params.
5. **Spacing matters.** Cass is sensitive to cramped or clipped UI. Generous padding on cards, comfortable line-heights, never let labels collide with values.
6. **Track instructions in this file.** Always update `PROJECT_NOTES.md` so we never lose context across compactions.
7. **Migrations are idempotent.** SQL files use `IF NOT EXISTS`, drop-then-recreate policies, and `CREATE OR REPLACE FUNCTION`. Cass should be able to re-run them safely.
8. **Codes are website-only delivery.** Members see their assigned codes only by signing in. Codes are never emailed to members.

---

## 7. Session Log

### Session — 2026-05-07 (this session) — v3 build-out

**Cass's request (six items):**
1. Redo the member dashboard cleaner + more comprehensive. Consolidate all nine service request forms into one robust dynamic form.
2. Member section to request access codes. Each member gets 2 a year — bake this in.
3. Member section to request that an invite be sent to a specific person.
4. Admin: log-in activity view + receive-requests views for the new flows + assign-code-to-member functionality. Codes are delivered through the website only.
5. Wish-flow currency limit (10K USD equivalent), dynamic per currency. Add P2P payment options (CashApp / Zelle / PayPal / Venmo + others). Capture relevant identifiers (username, email, phone). Double-entry verification + checkbox confirm. Fix cramped/clipped spacing throughout the flow.
6. Relocation copy: "guaranteed for US & Canada; outside, please still submit and we'll try our best." Capture full address (everything). Apply throughout the flow.

**Approach.**
- One SQL migration: `supabase/migration-v3.sql`
- One JS rewrite: `js/app.js` v3.0 (adds code requests, invite requests, login activity, currency rates helper, expanded badges)
- New pages: `pages/request.html`, `pages/my-codes.html`, `pages/invite-request.html`
- Rewritten pages: `pages/dashboard.html`, `pages/wish.html`, `pages/admin.html`
- Updated copy: `pages/access-info.html` (relocation US+Canada language)
- Updated sidebars across all authed pages to reflect new structure
- Deleted 9 `service-*.html` files

**Sidebar structure (post-v3) for all authed pages:**
- **Overview:** Dashboard · My Requests
- **Member Tools:** New Request · My Access Codes · Invite Someone
- **Account:** Settings · Admin Panel _(hidden unless admin)_

**Currency rates baked in (USD = 1.0 base; floor max to nearest 100):**
USD, EUR, GBP, CAD, AUD, JPY, CHF, MXN, INR, BRL, ZAR, CNY, KRW, SGD, HKD, NZD, SEK, NOK. `maxAmountInCurrency(code)` = `floor(10000 * rate / 100) * 100`.

**P2P methods supported in wish-flow money option:**
Bank Transfer · CashApp · Zelle · PayPal · Venmo · Crypto · Cash (in person) · Other. Each has its own field set (handle / email / phone / wallet address etc.) plus a confirmation re-entry plus a checkbox "I confirm the above information is correct."

**Relocation full-address capture:**
- Origin: country (with US/Canada vs. other branching), state/province, street address, city, unit (optional), postal/ZIP code
- Destination: country, state/province, city, neighborhood/notes (street optional)
- Plus existing fields: people count, children, pets, volume, timeline, notes

---

## 8. Pending / Future Ideas (Not yet requested)

- Member forum (was scoped earlier but Cass did not request in this round — hold off).
- Public "Request Membership" flow (no public path right now; invite-only by design).
- pg_cron nightly job to auto-send pending invites (Edge Function exists; scheduler optional).
- Two-factor auth (Supabase supports it — defer until requested).

---

## 9. Deployment Order

When Cass receives a zip from this session:

1. Replace deployed files (drag-drop in GitHub Pages repo).
2. **Run the SQL migration:** open Supabase SQL editor → paste contents of `supabase/migration-v3.sql` → Run. The migration is idempotent and safe to re-run.
3. Verify Supabase Auth settings unchanged (Site URL, Redirect URLs).
4. Smoke test: log in → dashboard loads → request code → admin assigns code → member sees it on `my-codes.html`.

---

_Last updated by Claude on 2026-05-07 during the v3 build session._

---

## 10. Session Continuation Log — 2026-05-07 (resumed after compaction)

This session resumed mid-build after the previous one was cut off. Cass uploaded a fresh zip with the prior session's files merged in, plus the original instruction text.

**What was completed in this resume:**

1. **Reconciled workspace** — used the uploaded zip as the canonical base, preserved `PROJECT_NOTES.md` and `supabase/migration-v3.sql` from the prior workspace, removed Windows artifacts (`desktop.ini`, the malformed `{css,js,pages}` folder), removed the duplicate `Migration v3.sql` at repo root in favour of `supabase/migration-v3.sql`.
2. **Deleted obsolete files** — the 9 `service-*.html` pages that were consolidated into `request.html`.
3. **Added global modal styles** to `css/styles.css` (`.modal-overlay`, `.modal-content`, `.modal-close`) so non-admin pages can use the same pattern.
4. **Added `.tab-pill` style** for badge counts on admin tab buttons.
5. **Created `pages/invite-request.html`** — member flow to nominate someone for an invitation (form + pending/history tabs).
6. **Created `pages/requests.html`** — member's "My Requests" view with status filter, click-to-detail modal, cancel-pending action. Was missing from the deployed site even though the dashboard sidebar already linked to it.
7. **Rewrote `pages/wish.html`** — adds the dynamic 18-currency cap with live max display, a P2P payment-method tile picker (Bank / CashApp / Zelle / PayPal / Venmo / Crypto / Cash in person / Other) each with its own field set + double-entry verification + a confirm checkbox; expanded relocation copy ("guaranteed: US & Canada — outside, please still submit"); full-address capture for origin (country/state/street/unit/city/postal) and destination (country/state/city/neighborhood). Generous spacing throughout — every field has 20 px bottom margin, subhead dividers between sections.
8. **Updated `pages/access-info.html`** — relocation tag changed from "U.S. residents only" to "Guaranteed: US & Canada" with best-effort copy below.
9. **Updated `pages/account.html` sidebar** — to the new structure (Overview / Member Tools / Account) and wired the admin-link reveal for admins.
10. **Extended `pages/admin.html`** — new sidebar entries for the new sections, three new tab buttons with pill badges (Code Requests / Invite Requests / Login Activity), three new tab panels with their own filters, three new modals (Approve & Assign Code, Deny Code Request, Adjust Allowance). Members table now shows allowance usage and an Adjust Allowance action. JS handlers all wired up — `loadCodeRequests`, `setCRFilter`, `openAssignModal`, `confirmAssignCode` (uses `approveCodeRequest` RPC + appends optional admin note to the code's `notes` field), `openDenyModal`, `confirmDenyCode`, `loadInviteRequests`, `setIRFilter`, `setIRStatus`, `viewInviteRequestReason`, `copyInviteEmail`, `loadLoginActivity`, `simplifyUA` (turns raw user agents into "Chrome · macOS"), `openAdjustAllowance`, `confirmAdjustAllowance`, `updatePillBadges` (refreshes pending counts on tab buttons).
11. **Validated** — all HTML inline scripts and `js/app.js` parse cleanly, every helper function used by every page exists in `js/app.js`.

**Things to verify after deploying:**
- The migration must be run before the new admin tabs work — they call `code_requests`, `invite_requests`, `login_activity` tables.
- Login activity only starts populating once members sign in *after* the migration is applied (the `signIn` helper logs each event fire-and-forget).
- The "Adjust Allowance" button on the members tab updates `codes_allowance_total` but does NOT reset `codes_used_this_year` — that resets nightly via `refresh_code_allowance` when the year rolls over (or call it manually from SQL).
- Sidebars on every member page now match the new three-section pattern. If Cass adds a new member page later, copy the sidebar block from `pages/my-codes.html`.

**Filename count this round:**
- 14 pages (`access-confirm`, `access-info`, `access`, `account`, `admin`, `confirm`, `dashboard`, `forgot-password`, `invite-request`, `login`, `my-codes`, `request`, `requests`, `reset-password`, `wish`)
- 1 stylesheet (`css/styles.css`, ~960 lines)
- 1 app script (`js/app.js`, ~450 lines)
- 1 migration (`supabase/migration-v3.sql`)
- 1 tracking doc (this file)

_Continuation log added by Claude on 2026-05-07._

---

## 11. Session — 2026-05-07 (refinements round)

Three targeted polish requests after the v3 build was deployed.

### Changes

1. **Wish.html Option C — pink callout spacing fixed.** The `.callout` style had a Cormorant Garamond italic title that wrapped awkwardly inside the constrained alert box, and paragraph margins were too tight (8px). Rewrote the styles:
   - Title: switched from serif italic to **Inter sans-serif** at 14px / 600 weight — feels like a proper notification, not a hijacked section header.
   - Padding: bumped to 24px 26px (was 20px 22px).
   - Icon: bumped to 40px circle (was 38px).
   - Inter-paragraph margin: bumped to 12px (was 8px).
   - Line-height: bumped to 1.85 (was 1.75).
   - Added `text-wrap: pretty` and `overflow-wrap: break-word` to prevent the awkward word breaks Cass was seeing.
   - Reworded the two callouts to be tighter ("Direct hand-off" / "Anonymous outreach" vs. the longer chatty titles).

2. **Wish.html Option C — Direct method recipient capture greatly expanded.** Was previously sparse (4 fields: name, relationship, timing, notes). Now captures the same depth as the Anonymous flow (without the contact-the-recipient bits since the member hands it off themselves):
   - Recipient's full name
   - Approximate age
   - Pronouns
   - Their relationship to the sender
   - City / region
   - Country
   - Preferred language
   - Expected timing (when they'll use the code)
   - Need type (financial / relocation / both / they'll choose / unsure)
   - General situation (textarea, with `.helper-line` examples)
   - Sensitivities or safety concerns (textarea)
   - Anything else (textarea)
   The submit handler stores everything as fields on `option_data` and emits a richer summary into `requests.request`.

3. **invite-request.html — full redesign to match the design language of `my-codes.html`.** Trashed the bespoke `.invite-shell` / `.invite-card` styles. The page now uses:
   - `.allowance-card` at the top showing 4 stats (pending / approved / sent / all-time) inside a new `.invite-stats` grid
   - "New invitation request" button that opens a `.form-section` panel (mirrors the my-codes "Request a code" panel pattern exactly)
   - `.tabs` / `.tab-btn` for the same Active &amp; in review / History split
   - `.assigned-code-card` with new `.invite-card-row` modifier for active items, showing recipient name, email, submitted date, relationship, the member's reason, and any admin note
   - `.helper-line` examples below the reason textarea (consistent with my-codes)
   - Ephemeral pink toast on success (consistent with my-codes' "Copied — share with care.")
   - All sidebar links match the standardized three-section pattern with Contact Sibeth in the Account section

4. **Contact Sibeth section already in place** from prior iteration:
   - `pages/contact-sibeth.html` — vCard-style page with phone, email, and international number, plus copy buttons and tel:/mailto:/sms: deep links
   - Sidebar entry on every authenticated page (dashboard, my-codes, requests, request, invite-request, account, admin)
   - Quick-action tile on the dashboard

### CSS additions
- `.invite-stats`, `.invite-stat`, `.ist-num`, `.ist-lbl` (4-up grid for invite stats)
- `.invite-card-row`, `.invite-row-left`, `.invite-row-right` (modifier for `.assigned-code-card`)
- `.invite-recipient`, `.invite-email`, `.invite-meta`, `.invite-meta-r`, `.invite-reason`, `.invite-admin-note`

### Validation
- All inline JS in modified pages parses cleanly via `new Function()` test
- All app.js helpers used by invite-request.html exist
- Sidebars on all 9 authenticated pages match the three-section pattern with Contact Sibeth in Account

_Refinements log added by Claude on 2026-05-07._

---

## 12. Session — 2026-05-08 (admin visibility fixes)

Three blocking bugs surfaced after the v3 build went live, plus a small request to expose every form field in the admin panel.

### Issue #1 — Admin tabs (Code Requests, Invite Requests, Login Activity) wouldn't load

**Root cause:** The v3 migration created the three new tables with foreign keys pointing at `auth.users(id)`. The admin queries in `js/app.js` use Supabase's embed syntax (`profiles!code_requests_user_id_fkey(...)`), which requires the FK to point at `public.profiles(id)` for PostgREST to resolve the join. Because the FK was pointing at `auth.users` instead of `profiles`, PostgREST returned 400s and the admin tables silently rendered "Failed to load."

**Fix:** Re-target each FK to `public.profiles(id)`. Cascade behavior is preserved because `profiles.id` already references `auth.users(id) ON DELETE CASCADE`. The fix lives in two places:
- **`supabase/migration-v3.sql`** — appended a new section 12 (FK retargeting) so the canonical migration is self-correcting.
- **`supabase/migration-v3-patch1.sql`** — standalone patch file Cass can run right now without re-running the full migration.

Both are idempotent. Running either one resolves the admin tab issue. The patch also includes `NOTIFY pgrst, 'reload schema'` to force PostgREST to pick up the change immediately (otherwise it may take a minute).

### Issue #2 — Wish admin modal didn't show all submitted data

**Root cause:** The wish modal renderer flattened `option_data` with `Object.entries(...).map(([k,v]) => escapeHtml(v))` — but the v3 wish form stores nested objects (`from: {country, state, street, ...}`, `to: {...}`, `payment: {method, holder, ...}`). Those nested objects rendered as `[object Object]`.

**Fix:** Built a recursive renderer `renderDataTree(data, depth)` that:
- Walks any object/array
- Skips null/empty/undefined
- Renders nested objects as visually distinct sub-blocks with italic Cormorant section headers (`.data-subblock`)
- Handles arrays as numbered sub-items
- Nicely displays booleans as ✓ Yes / ✗ No
- Uses a custom-key map (`prettyKey()`) for human-friendly labels (e.g. `from_country` → "From Country", `recipient_safety` → "Safety Concerns")

Both the wish modal and the request modal now use `renderDataTree()`, so requests with nested form data also render properly.

### Issue #3 — Reference ID not visible to admin

**Root cause:** Members see a Reference ID on the success screen (computed as `sessionId.split('-')[0].toUpperCase()`). The admin had no way to find a wish by that ID.

**Fix:** Both the wish and request modals now show the reference ID in a prominent pink banner at the top (`.ref-banner`). For wishes it's derived from `session_id` (matching what the member sees); for requests it's derived from the request's own `id`. The full session_id is also shown in the metadata as a separate row for completeness.

### CSS additions (admin.html)
- `.ref-banner`, `.ref-banner-label`, `.ref-banner-value` — pink banner with the reference ID at the top of detail modals
- `.data-subblock`, `.data-subblock-title` — visually distinct nested-object container with italic Cormorant header
- Mobile: `.data-subblock .field-row` collapses to single column

### Validation
- Admin.html inline JS parses cleanly via `new Function()` test
- `getAllCodeRequests`, `getAllInviteRequests`, `getAllLoginActivity` all use the now-resolvable `profiles!*_fkey(...)` embed syntax
- Wish/request modals tested mentally against representative payloads (relocation with from/to, money with payment object)

### Deployment
1. Replace deployed files with the zip
2. **Run `supabase/migration-v3-patch1.sql` in Supabase SQL editor** — this is the critical step that makes the admin tabs work
3. Smoke test: log in as admin → Code Requests tab should load; Invite Requests tab should load; Login Activity should show recent sign-ins
4. Have a member submit a wish (any option) → as admin, click into it → confirm the Reference ID banner appears, all fields including nested ones (from/to address, payment details) are visible

_Admin visibility fixes added by Claude on 2026-05-08._

---

## 13. Session — 2026-05-08 (send-invite hardening)

Audit of the admin Send Invite flow turned up two issues plus an opportunity:

### Issues found
1. **No Edge Function source in the repo** — `js/app.js`'s `sendInvites()` POSTs to `/functions/v1/send-invite`, but the Function only existed in Supabase. Any drift between the deployed code and the front-end was invisible. If the deploy was missing, broken, or had the wrong Resend setup, the Send button failed silently.
2. **Schema couldn't track failures** — `pending_invites` only had `accepted` (boolean) and `sent_at`. There was no way to distinguish "never sent" from "send failed" from "actually accepted," and no place to store the error message when Resend rejected an email.

### What shipped

**`supabase/functions/send-invite/index.ts`** — complete, audited source for the Edge Function. Highlights:
- Verifies the caller's JWT is valid AND their profile has `is_admin = true` OR `role = 'admin'`
- Accepts three body shapes: `{invite_id}`, `{send_all: true}`, or `{test_to: "email"}`
- Calls Resend's REST API directly (no SDK dependency, so no version drift)
- Per-row error capture — if one send fails the others keep going
- On success: writes `status='sent'`, `sent_at=NOW()`, clears `last_send_error`, and sets legacy `accepted=true` so old UI doesn't break
- On failure: writes `status='failed'`, `last_send_error=<full Resend response>`, leaves `accepted=false`
- Returns `{sent, failed, attempted, message, errors: [{email, error}]}`
- Branded HTML template + plain-text alternative, both using the site's dark theme aesthetic

**`supabase/migration-v3-patch2.sql`** — adds two columns to `pending_invites`:
- `status` text — `pending` / `sent` / `accepted` / `failed`
- `last_send_error` text — debugging breadcrumbs from Resend
- Backfills existing rows with sensible status values
- Idempotent

**`pages/admin.html` Invitations tab** rewired:
- Status column uses the new `inviteStatusBadge()` with 4 colors (amber/green/pink/red)
- Failed sends show the Resend error inline as a sub-row in red monospace — admin can diagnose without leaving the page
- Failed rows get a "Retry" button (vs. "Send Now" for never-sent)
- `handleSendOne` / `handleSendAll` now surface real error messages with proper colors and longer timeouts (8–12s)
- New "🧪 Test send" button — prompts for an email and sends a one-off invitation that never touches the pending list. Perfect for verifying the Resend pipeline works without polluting your real invite queue.

### Deployment checklist (do these in order)

1. **Run the SQL patch** in Supabase SQL Editor:
   ```
   supabase/migration-v3-patch2.sql
   ```
   Adds the `status` and `last_send_error` columns.

2. **Deploy the Edge Function** (one-time setup if not already done):
   ```bash
   # Install the Supabase CLI if you don't have it
   npm i -g supabase

   # From the project root:
   supabase login
   supabase link --project-ref aoxheyrtxygerkqsveaf
   supabase functions deploy send-invite
   ```
   (If the CLI route feels heavy, you can also paste the contents of `supabase/functions/send-invite/index.ts` directly into the Supabase Dashboard → Edge Functions → send-invite → Edit.)

3. **Set the Resend secret** in Supabase (Dashboard → Project Settings → Edge Functions → Secrets):
   ```
   RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   Optional overrides:
   ```
   INVITE_FROM_EMAIL = fractured Ego <invites@fracturedego.org>
   INVITE_REPLY_TO   = admin@fracturedego.org
   SITE_URL          = https://fracturedego.org
   ```

4. **Verify the Resend sending domain** at https://resend.com/domains
   - Add `fracturedego.org`
   - Add the DNS records they show (SPF + DKIM, usually two TXT records and one MX-like record)
   - Wait for "Verified" status (usually under 15 minutes after DNS propagates)

5. **Test the pipeline:**
   - Open admin → Invitations tab → click 🧪 Test send → enter your own email → check inbox + spam
   - If it lands: deploy is good. Click Send Now on a real pending invite.
   - If it errors: the error message will appear next to the button AND in the inline error row in the invite list. Common causes:
     - `RESEND_API_KEY secret not set` → step 3
     - `Resend 401` → wrong API key
     - `Resend 403: domain not verified` → step 4
     - `Function not found` → step 2 didn't deploy successfully

### Files added/modified this session
- **NEW** `supabase/functions/send-invite/index.ts`
- **NEW** `supabase/migration-v3-patch2.sql`
- **MODIFIED** `pages/admin.html` — invites tab UI + handlers
- **MODIFIED** `PROJECT_NOTES.md` — this section

_Send-invite hardening added by Claude on 2026-05-08._

---

## 13a. Hotfix — 2026-05-08 (patch2 column safety)

When Cass ran `migration-v3-patch2.sql`, Postgres rejected it with `ERROR: 42703: column "accepted" does not exist`. The deployed `pending_invites` table apparently never had that column — the front-end's old `logInvite` insert with `accepted: false` was getting silently rejected by PostgREST (which explains why historically the Invitations tab never actually populated even before this round of changes).

### What changed
- **`supabase/migration-v3-patch2.sql`** rewritten to be fully defensive — uses `ADD COLUMN IF NOT EXISTS` for every column (`accepted`, `sent_at`, `invited_at`, `last_send_error`) and a `DO $$ ... END$$` block for the constrained `status` column. The backfill now keys off `sent_at IS NOT NULL` only, not `accepted`. Works regardless of starting schema.
- **`js/app.js`** — `logInvite` no longer inserts `accepted: false`; inserts `status: 'pending'` instead, which always exists after patch2.
- **`supabase/functions/send-invite/index.ts`** — Edge Function no longer writes `accepted=true`. The success path writes only `status='sent'`, `sent_at=NOW()`, `last_send_error=null`. Cleaner semantics.
- **`pages/admin.html`** — every read of `i.accepted` replaced with the status determination (`status || (sent_at ? 'sent' : 'pending')`). The overview pending-invites counter and the Send All filter now use status too.

### Run order
Re-run **`migration-v3-patch2.sql`** — it's idempotent, will add only the missing columns, and will succeed this time because it no longer references columns that may not exist. Then re-deploy the Edge Function (or re-paste it into the dashboard) and you're set.

_Hotfix added by Claude on 2026-05-08._
