# Rebuild Guide — QR Attendance System (Neon + Vercel)

Everything needed to stand this project up again, for a new branch, a new company,
or a new Neon project. Written from the actual working system, including the traps
we hit.

Two ways to use it:

- **Scenario A (recommended, ~30–45 min):** copy this repository and point it at a
  new Neon project. Section 4 is the step-by-step.
- **Scenario B:** build the same app from scratch. Section 6 has the database
  reference and Section 5 the rules that make the client work.

---

## 1. What the app does

- Employees **time in** by scanning a rotating office QR code with their phone.
- Admins get a dashboard (today's arrivals, late count, who is missing), manage
  employee accounts, display/print the QR, and export Excel reports.
- One check-in per employee per calendar day, evaluated in **Africa/Mogadishu**
  time. Friday is a weekly day off.
- Late/on-time is decided by two configurable thresholds (morning / afternoon).

## 2. Architecture

```
Browser (React SPA, Vite, PWA)
   │  email or username + password
   ├──────────────► Neon Auth (Managed Better Auth)  /neondb/auth
   │                  └─ session cookie + short-lived JWT from GET /token
   │  Authorization: Bearer <JWT>
   └──────────────► Neon Data API (PostgREST-compatible)  /neondb/rest/v1
                      ├─ tables: profiles, attendance, qr_tokens, app_settings
                      └─ RPCs: create_qr_token, scan_attendance, admin_*
```

- **Neon Auth** stores users in `neon_auth.user` / `neon_auth.account` (scrypt
  password hashes) and issues the JWT.
- **Neon Data API** is PostgREST. `supabase-js` is used **only as the HTTP
  transport**; every request carries the Neon JWT, so `auth.uid()` and RLS work.
- **No server of our own.** Vercel serves the static SPA; all logic is RLS +
  `SECURITY DEFINER` functions in Postgres.

## 3. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 20.19 | `@neon/auth` requires it |
| npm | any recent | |
| Neon CLI | 9.x | `npm i -g neon`, then `neon auth` |
| Git | any | |
| Vercel account | — | free tier is fine |

---

## 4. Scenario A — new project from this repository

### Step 1 — Copy the code

```bash
git clone <this-repo-url> qr-attendance-<branch>
cd qr-attendance-<branch>
npm install
```

Delete the old `.neon` link file if it came along (it is git-ignored, but check):

```bash
rm -f .neon            # Windows PowerShell: Remove-Item .neon
```

### Step 2 — Create and link a Neon project

```bash
neon auth                                  # browser sign-in, once
neon link --project-name qr-attendance-<branch> --region-id aws-eu-west-2
```

This creates the project, writes `.neon` (org / project / branch) and pulls the
branch environment into `.env.local`.

If you already have a project:

```bash
neon link --project-id <project-id> --branch production
```

### Step 3 — Provision Auth and the Data API

`neon.ts` in the repo root already declares them:

```ts
export default defineConfig({
  auth: true,
  dataApi: true,
  branch: (branch) => (branch.exists ? {} : { ttl: "7d" }),
});
```

Apply it and pull the endpoints:

```bash
neon deploy            # provisions Auth + Data API, then pulls env
neon status            # confirm both services exist on the branch
```

`neon deploy` writes variables such as `NEON_AUTH_BASE_URL`,
`NEON_DATA_API_URL`, `NEON_AUTH_JWKS_URL`, `DATABASE_URL` into `.env.local`.

### Step 4 — Add the two browser variables

The SPA only reads `VITE_*` variables. Add these to `.env.local` (and later to
Vercel):

```env
VITE_NEON_AUTH_URL=https://<auth-host>/neondb/auth
VITE_NEON_DATA_API_URL=https://<data-host>/neondb/rest/v1

# used by scripts only, never by the browser
ADMIN_EMAIL=owner@company.com
ADMIN_PASSWORD=<the admin password you create in step 6>
```

Notes:

- Keep the path: `/neondb/auth` and `/neondb/rest/v1`. `neondb` is the database
  name; change it only if you renamed the database.
- `src/lib/neon.ts` contains fallbacks for the original project. **Replace them**
  with your new URLs, or delete the fallbacks so a missing variable fails loudly.

### Step 5 — Create the schema

Run the three migrations in order, then refresh PostgREST’s cache:

```bash
node scripts/apply-sql.mjs db/migrations/001_neon_auth_scrypt_rpcs.sql
node scripts/apply-sql.mjs db/migrations/002_admin_email.sql
node scripts/apply-sql.mjs db/migrations/003_qr_ttl_and_revoke.sql
neon data-api refresh-schema
```

`refresh-schema` is mandatory after adding functions, otherwise the Data API
answers `PGRST202: Could not find the function ...`. It is also available as
`POST`-free CLI: `neon data-api refresh-schema`, or Console → Data API → Refresh.

What the migrations create (details in Section 6):

- tables `profiles`, `attendance`, `qr_tokens`, `app_settings`
- RLS policies + `is_admin()`
- RPCs `create_qr_token`, `revoke_qr_tokens`, `scan_attendance`,
  `admin_create_user`, `admin_update_employee`, `admin_reset_password`,
  `admin_delete_employee`
- `auth.uid()` comes from the Neon extension; no work needed.

### Step 6 — Bootstrap the first administrator

There is a chicken-and-egg problem: creating users needs an admin, and admins are
created by the app. Solve it once with the Auth sign-up endpoint, then attach a
profile row.

1. Create the auth user (this hashes the password the way Better Auth expects):

```bash
AUTH="https://<auth-host>/neondb/auth"
curl -s -X POST "$AUTH/sign-up/email" \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  -d '{"email":"owner@company.com","password":"<strong-password>","name":"Owner"}'
```

2. Promote it to admin. Save this as `db/bootstrap-admin.sql` (temporary file):

```sql
insert into public.profiles (id, full_name, employee_number, username, role, shift, is_active)
select id, 'Owner', 'ADMIN01', 'admin', 'admin', 'morning', true
from neon_auth.user
where email = 'owner@company.com'
on conflict (id) do update
  set role = 'admin', is_active = true;
```

```bash
node scripts/apply-sql.mjs db/bootstrap-admin.sql
```

3. Put the same email/password into `.env.local` as `ADMIN_EMAIL` /
   `ADMIN_PASSWORD` — the maintenance scripts sign in with them.

Every later admin can be created without SQL:

```bash
node scripts/add-admin.mjs newadmin@company.com 'StrongPassword!' "New Admin"
```

Running it again with the same email **resets that admin’s password**.

### Step 7 — Run locally

```bash
npm run dev        # http://localhost:5173
```

`http://localhost:5173` is a default Neon Auth trusted origin, so sign-in works
immediately. Open the URL, sign in with `admin` (or the full email) and the
password from step 6.

### Step 8 — Deploy to Vercel

1. Push the repo to GitHub (Vercel will rebuild on every push to `main`).
2. Vercel → **New Project** → import the repo → framework preset **Vite**,
   build `npm run build`, output `dist`.
3. Add environment variables for **Production and Preview**:

   ```
   VITE_NEON_AUTH_URL=https://<auth-host>/neondb/auth
   VITE_NEON_DATA_API_URL=https://<data-host>/neondb/rest/v1
   ```

4. Register the deployment domain as a trusted origin — **without a trailing
   slash**:

   ```bash
   neon neon-auth domain add https://<project>.vercel.app
   neon neon-auth domain list
   ```

   If the console shows `https://<project>.vercel.app/` (with slash) and sign-in
   fails with “Failed to fetch”, add the no-slash version as well.

5. `vercel.json` already rewrites all routes to `index.html` and sends
   `no-cache` for `index.html`, `sw.js` and the manifest so new builds are picked
   up immediately.

### Step 9 — Verify

```bash
# 17 checks: auth, RLS, create employee, QR cap/revoke, scan, reset, delete
ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/e2e-neon.mjs

# browser check: real login, prints page text, saves a screenshot
ADMIN_EMAIL=admin ADMIN_PASSWORD='...' node scripts/ui-diag.mjs https://<project>.vercel.app
```

Expected: `17/17 checks passed`, and the UI check reaches `/admin` with no failed
requests.

### Step 10 — Backups

```bash
neon snapshots create --branch production --name "backup-$(date +%F)"
neon snapshots list
```

Automatic daily snapshots on Windows (this repo ships the script):

```powershell
$tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\scripts\backup-db.ps1"'
schtasks /Create /TN "Qardho DB Backup" /SC DAILY /ST 02:00 /TR $tr /F
```

`scripts/backup-db.ps1` creates `auto-YYYY-MM-DD`, keeps 14 days, logs to
`backups/backup.log`. Restore:

```bash
neon snapshots restore <id> --name restore-check   # verify first
neon snapshots finalize restore-check
```

Neon’s built-in *backup schedule* may be unavailable on the Free plan
(`backup schedule creation is not enabled`); the script above covers it.

---

## 5. The ten rules that make the client work

These are the non-obvious parts. Break one and you get a spinner or a 401.

1. **Better Auth verifies scrypt only.** Hashes are `"<32 hex salt>:<128 hex key>"`
   (N=16384, r=16, p=1, dkLen=64). bcrypt hashes never match. The browser hashes
   with `hashPassword()` in `src/lib/neon.ts`, and the RPCs take `p_password_hash`.
   Never send a plaintext password to the database.

2. **`createAuthClient(url)` returns the Better Auth client, not a wrapper.**
   `auth.getJWTToken()` does not exist at runtime. Get the JWT yourself:
   `fetch(`${AUTH}/token`, { credentials: 'include' })` → `{ token }`.

3. **The Data API base URL has no `/rest/v1` when passed to supabase-js.**
   `supabase-js` appends `/rest/v1` itself. `src/lib/neon.ts` strips it:
   `NEON_DATA_API_URL.replace(/\/rest\/v1\/?$/, '')`.

4. **The JWT goes in `accessToken`, not the anon key.**
   `createClient(base, 'neon-data-api', { accessToken: () => getJwt() })`.
   Without it PostgREST replies *“Provided authentication token is not a valid JWT
   encoding”*.

5. **Cache the JWT and clear it on sign-in/sign-out.** It lives ~15 minutes;
   `getJwt()` caches until 30 s before `exp`. Forgetting to clear it after a user
   switch serves the previous user’s data.

6. **Employees log in with a username.** The app appends
   `@attendance-login.example.com` when the input has no `@`. A real-email admin
   must type the full address.

7. **RLS always applies.** The admin RPCs re-check `is_admin()`; the client never
   gets to bypass it. `attendance` has a unique `(employee_id, work_date)` so a
   double scan cannot duplicate a row.

8. **New SQL functions need a schema-cache refresh** (`neon data-api
   refresh-schema`). Without it the Data API cannot see them.

9. **QR tokens are hashed at rest.** `create_qr_token` returns the raw token once,
   stores only its SHA-256; `scan_attendance` hashes the scan and compares.
   Lifetime is clamped to 30 s–24 h; `revoke_qr_tokens()` kills all active codes.

10. **Old PWA builds haunt you.** A service worker can serve a previous bundle
    indefinitely. `src/main.tsx` reloads once when a new worker takes control, and
    `vercel.json` marks `sw.js`/`index.html` no-cache. Users who visited before
    this existed need one hard refresh.

---

## 6. Database reference

### Tables (`public`)

| Table | Columns | Notes |
| --- | --- | --- |
| `profiles` | `id uuid PK → neon_auth.user(id)`, `full_name`, `employee_number unique`, `username unique`, `role ('admin'\|'employee')`, `department`, `shift ('morning'\|'afternoon')`, `is_active`, `created_at` | One row per login |
| `attendance` | `id`, `employee_id → profiles`, `work_date`, `time_in`, `status ('present'\|'late')`, `shift`, `created_at` | `unique(employee_id, work_date)` |
| `qr_tokens` | `id`, `token_hash unique`, `expires_at`, `created_at` | Raw token never stored |
| `app_settings` | `setting_key PK`, `setting_value`, `updated_at` | `late_after_morning`, `late_after_afternoon`, legacy `late_after` |

### Functions

| Function | Purpose |
| --- | --- |
| `is_admin()` | `auth.uid()` has `role='admin'` and `is_active` |
| `create_qr_token(p_duration_seconds int = 45)` | Admin-only; clamps 30–86 400 s; returns `{token, expires_at}` |
| `revoke_qr_tokens()` | Admin-only; deletes all unexpired tokens |
| `scan_attendance(p_token text)` | Employee-only; validates hash + expiry, Friday block, late/on-time, one row per day |
| `admin_create_user(full_name, employee_number, username, password_hash, role, shift, department, email)` | Creates `neon_auth.user` + credential account + profile |
| `admin_update_employee(id, full_name, employee_number, department, shift)` | Edits profile + auth name |
| `admin_reset_password(id, password_hash)` | Replaces credential hash, drops sessions |
| `admin_delete_employee(id)` | Deletes attendance, profile, account, sessions, user (refuses admins) |

`p_email` is optional: omit it and the auth email becomes
`<username>@attendance-login.example.com`; provide it for admins who sign in with
a real address.

### RLS

- `profiles`: self `SELECT`, admin `SELECT`/`UPDATE`
- `attendance`: self `SELECT`, admin `SELECT`
- `app_settings`: authenticated `SELECT`, admin `ALL`
- `qr_tokens`: no policies — only the security-definer functions touch it

---

## 7. File map

| Path | Purpose |
| --- | --- |
| `src/lib/neon.ts` | Auth client, JWT cache, PostgREST client, `hashPassword`, profile loader, 401 hook |
| `src/lib/api.ts` | RPC wrappers (`generateQrToken`, `recordAttendance`, admin actions) |
| `src/lib/date.ts` | Mogadishu date/time helpers, Friday check |
| `src/pages/Login.tsx` | Username→email mapping, timeouts, session-expired message |
| `src/pages/Admin.tsx` | Dashboard, employees, QR display, reports (one file, four screens) |
| `src/pages/Employee.tsx` | Scanner (`html5-qrcode`) + own history |
| `src/components/` | `ErrorBoundary`, `Notice` |
| `db/migrations/00*.sql` | Scrypt RPCs, admin email, QR TTL/revoke |
| `neon.ts` | Neon service config (`auth: true`, `dataApi: true`) |
| `scripts/apply-sql.mjs` | Runs a `.sql` file against `DATABASE_URL_UNPOOLED` |
| `scripts/add-admin.mjs` | Create admin / reset admin password |
| `scripts/e2e-neon.mjs` | 17 backend checks against the live project |
| `scripts/backup-db.ps1` | Daily snapshot + 14-day retention |
| `scripts/ui-*.mjs`, `cdp-check.mjs` | Headless Chrome checks and screenshots |
| `vercel.json` | SPA rewrites + no-cache for `sw.js`/`index.html` |

---

## 8. Customising for a new branch or company

| Change | Where |
| --- | --- |
| App name / title | `index.html`, `vite.config.ts` (PWA manifest), `src/App.tsx` header, `src/pages/Login.tsx` |
| Branch name in UI | `Login.tsx` headline, `Admin.tsx` QR poster text |
| Colours | `src/style.css` (`--qardho-red`, `--qardho-ink`, …) |
| **Timezone** | `src/lib/date.ts` **and** `scan_attendance` in SQL (`Africa/Mogadishu`, `UTC+3` comment) — recreate the function after editing |
| Late thresholds | `app_settings` rows (also editable on the dashboard) |
| Shifts | `profiles.shift` / `attendance.shift` checks, `admin_update_employee`, the two selects in `Admin.tsx` |
| Friday day off | `scan_attendance` (`v_weekday = 'Fri'`) |
| QR rotation | `Admin.tsx` interval buttons (15 s–5 m), token TTL = interval + 25 s |

The timezone is duplicated in the database function. Changing only the frontend
gives you a dashboard in one timezone and check-ins in another.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| “Signing in…” forever, then *Failed to fetch* | Wrong/truncated `VITE_NEON_AUTH_URL`, or the domain is not a trusted origin | Fix the variable (must end in `/neondb/auth`), `neon neon-auth domain add <origin>` |
| `PGRST202 … could not find the function` | PostgREST schema cache is stale | `neon data-api refresh-schema` |
| `Provided authentication token is not a valid JWT encoding` | `accessToken` returned null or the opaque session token | Fetch the JWT from `GET /token` and pass it to `accessToken` |
| Password reset “works” but login fails | A bcrypt hash was stored | Use `admin_reset_password` with a scrypt hash (the app does) |
| Employee cannot sign in with their username | They have a real-email account and must type the full address, or the username is wrong | Check the account list / `neon_auth.user` |
| QR always “expired” | Token was revoked, or the server clock/timezone is off | Regenerate; verify `timezone('Africa/Mogadishu', now())` |
| Old blue/previous UI after deploy | Service worker served a cached bundle | Hard refresh (Ctrl+Shift+R) or clear site data |
| Vite dies with `EBUSY … .tmpdir` on Windows | Editor atomic writes + file watcher | Already ignored in `vite.config.ts` (`*.tmpdir`, `.tmp`) |
| `npm run build` fails with `spawn EPERM` in a sandbox | esbuild cannot spawn under confinement | Run the build outside the sandbox |
| Login page logs `401 /token` before sign-in | Harmless probe while signed out | Ignore |
| Dashboard empty every 10 s | Poll runs while hidden / JWT expired | Expected: polling pauses on hidden tabs; re-login on expiry |

---

## 10. New-project checklist

```
[ ] neon link --project-name <name> --region-id <region>
[ ] neon.ts has auth:true, dataApi:true  →  neon deploy
[ ] .env.local: VITE_NEON_AUTH_URL, VITE_NEON_DATA_API_URL (+ ADMIN_EMAIL/PASSWORD)
[ ] node scripts/apply-sql.mjs db/migrations/001…003
[ ] neon data-api refresh-schema
[ ] sign-up first auth user + insert admin profile row
[ ] npm run dev → sign in at http://localhost:5173
[ ] Vercel: import repo, set the two VITE_ variables, deploy
[ ] neon neon-auth domain add https://<domain>   (no trailing slash)
[ ] ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-neon.mjs   → 17/17
[ ] create a real employee, scan the QR from a phone, confirm the row
[ ] enable daily snapshots (schtasks or CI)
[ ] change the bootstrap password
```
