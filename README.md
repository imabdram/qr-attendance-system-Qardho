# Qardho Attendance Portal

QR attendance for the Qardho branch. Employees scan the office QR code with their
phone to record **Time In**; admins see today's arrivals, manage accounts and
export Excel reports.

**Live:** https://qr-attendance-system-qardho.vercel.app

## What it does

- One check-in per employee per day, in **Africa/Mogadishu** time (Friday = day off).
- On-time or late is decided by two editable thresholds (morning / afternoon shift).
- Admin dashboard refreshes every 10 seconds.
- Reports filter by **Present / Late / Absent** and export to `.xlsx`.
- Installable as a phone app (PWA).

## Sign in

| Who | Username | Password |
| --- | --- | --- |
| Admin | `admin` or the full admin email | set by the admin |
| Employee | their username (e.g. `ahmed01`) | set when the account was created |

Employees type only their username — the app adds `@attendance-login.example.com`.
Admins with a real email must type the complete address.

## Main screens

- **Dashboard** — present, late, not checked in; change the late times.
- **Employees** — add, edit, reset password, activate/deactivate, delete.
- **QR Display** — show or print the code employees scan.
- **Reports** — date range + status filter, Excel export.

## QR codes

Two modes on the **QR Display** page:

| Mode | Behaviour |
| --- | --- |
| **Changed by hand** | Stays the same until you press *Change QR Code*. Confirmation is asked, the old code is revoked. Has **Print QR Poster**. |
| **Auto every** | Rotates automatically every *x* minutes / hours / days (maximum 30 days). |

Every code expires within **30 days**. Use **Revoke QR Codes** immediately if a code
leaks. Only signed-in employees can scan.

## Tech stack

- React 19 + TypeScript + Vite (PWA), `lucide-react` icons
- **Neon Postgres** (branch `production`) with Row Level Security
- **Neon Auth** (Managed Better Auth) — sessions + JWT
- **Neon Data API** (PostgREST) — tables and stored functions; `supabase-js` is only the HTTP client
- `html5-qrcode` scanner, `qrcode.react` display, `xlsx` export
- Hosted on **Vercel**

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run preview
```

## Environment (`.env.local`)

```env
VITE_NEON_AUTH_URL=https://<host>/neondb/auth
VITE_NEON_DATA_API_URL=https://<host>/neondb/rest/v1
DATABASE_URL=postgresql://...            # scripts only
DATABASE_URL_UNPOOLED=postgresql://...   # scripts only
ADMIN_EMAIL=admin@attendance-login.example.com
ADMIN_PASSWORD=...                       # used by maintenance scripts
```

Only the two `VITE_` values reach the browser. Never put `DATABASE_URL` or
`ADMIN_PASSWORD` in Vercel’s `VITE_` variables.

## Database

SQL lives in `db/migrations/` and is applied in order:

```bash
node scripts/apply-sql.mjs db/migrations/001_neon_auth_scrypt_rpcs.sql
node scripts/apply-sql.mjs db/migrations/002_admin_email.sql
node scripts/apply-sql.mjs db/migrations/003_qr_ttl_and_revoke.sql
node scripts/apply-sql.mjs db/migrations/004_qr_ttl_30_days.sql
neon data-api refresh-schema        # required after adding/changing functions
```

Tables: `profiles`, `attendance`, `qr_tokens`, `app_settings` (plus `neon_auth.*`).
Functions: `create_qr_token`, `revoke_qr_tokens`, `scan_attendance`, `admin_create_user`,
`admin_update_employee`, `admin_reset_password`, `admin_delete_employee`, `is_admin`.

Passwords use Neon Auth’s **scrypt** hashes; the browser hashes them before the RPC,
so plaintext never reaches the database.

## Accounts

- Create employees from **Employees → Add Employee**.
- Create or re-password an admin from the command line:

```bash
node scripts/add-admin.mjs person@example.com 'StrongPassword!' "Their Name"
```

Running the same command twice resets that admin’s password.

## Deploy (Vercel)

1. Push to GitHub — Vercel rebuilds automatically.
2. Project settings: framework **Vite**, build `npm run build`, output `dist`.
3. Add `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` (Production + Preview).
4. Register the domain with Neon Auth:

```bash
neon neon-auth domain add https://<project>.vercel.app
neon neon-auth domain list
```

`vercel.json` handles SPA routing and stops old builds being cached.

## Backups

A snapshot is taken every day at 02:00 by the Windows task **Qardho DB Backup**
(14 days kept, log in `backups/backup.log`). Manual run and restore:

```bash
neon snapshots create --branch production --name "before-changes-$(date +%F)"
neon snapshots list
neon snapshots restore <snapshot-id> --name restore-check
```

Backups include logins (`neon_auth`) as well as attendance.

## Checks

```bash
# ADMIN_EMAIL / ADMIN_PASSWORD from the shell or .env.local
node scripts/e2e-neon.mjs       # 17 backend checks against live Neon
```

Other helpers in `scripts/`: `audit-neon.mjs` (schema), `apply-sql.mjs`,
`add-admin.mjs`, `cleanup-test-employees.mjs`, `backup-db.ps1`, and headless UI
screenshots (`ui-login.mjs`, `ui-diag.mjs`, `cdp-check.mjs`).

## More documentation

- **[REBUILD_GUIDE.md](REBUILD_GUIDE.md)** — step-by-step rebuild for another
  branch/company, including the traps we hit.
- `db/migrations/` — the database contract.
- `src/lib/neon.ts` — auth, JWT and PostgREST wiring.
