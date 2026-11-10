# Qardho Attendance Portal

QR-based employee **Time In** for the Qardho branch. A rotating office QR code is
shown on the admin dashboard; employees scan it from their phones to record
attendance. Admins manage accounts, monitor today's arrivals, and export
date-filtered Excel reports.

## Stack

- React 19 + TypeScript + Vite (PWA)
- **Neon Lakebase Postgres** (project `qr-attendance-system-Qardho`, branch `production`)
- **Neon Auth** (Managed Better Auth) for sign-in, sessions, and JWT issuance
- **Neon Data API** (PostgREST-compatible) for tables and stored functions, guarded by RLS
- Supabase JS used **only** as the PostgREST transport for the Data API
- `html5-qrcode` scanner, `qrcode.react` display, `xlsx` export

## Architecture

```
Browser (React SPA)
   │  sign-in / session cookie
   ├──────────────► Neon Auth  /neondb/auth
   │                   └─ issues short-lived JWT (GET /token)
   │  Bearer <JWT>
   └──────────────► Neon Data API  /neondb/rest/v1
                       ├─ tables (profiles, attendance, qr_tokens, app_settings)
                       └─ RPCs (create_qr_token, scan_attendance, admin_*)
```

Row Level Security still applies: `auth.uid()` comes from the JWT, and every
admin RPC re-checks `public.is_admin()`.

## Environment

Copy `.env.example` to `.env.local`:

```env
VITE_NEON_AUTH_URL=https://<endpoint>.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth
VITE_NEON_DATA_API_URL=https://<endpoint>.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1
```

Server-side only (migrations/scripts, never bundled):

```env
DATABASE_URL=postgresql://…            # pooled
DATABASE_URL_UNPOOLED=postgresql://…   # direct, used by scripts
```

Both `VITE_` values have production defaults baked into `src/lib/neon.ts`, so a
Vercel build works even if the variables are not set — but setting them per
environment is recommended.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview
```

## Database

Schema objects live in `db/migrations/` (the historical `supabase/migrations`
files document the original schema and are no longer applied).

```bash
node scripts/apply-sql.mjs db/migrations/001_neon_auth_scrypt_rpcs.sql
neon data-api refresh-schema      # after adding/removing functions
```

### Stored functions

| Function | Purpose |
| --- | --- |
| `create_qr_token(p_duration_seconds)` | Issues a QR token (30 s – 24 h), stores only its SHA-256 hash |
| `revoke_qr_tokens()` | Admin-only: invalidates every active QR code at once |
| `scan_attendance(p_token)` | Validates the token and writes a Time In row (Mogadishu date, shift-aware late detection) |
| `admin_create_user(...)` | Creates `neon_auth.user` + credential account + `public.profiles` row |
| `admin_update_employee(...)` | Updates name / phone / department / shift |
| `admin_reset_password(...)` | Replaces the credential hash and drops existing sessions |
| `admin_delete_employee(...)` | Deletes attendance, profile, account, sessions, and the auth user |
| `is_admin()` | RLS helper backed by the JWT |

### Passwords

Neon Auth (Better Auth) verifies **scrypt** hashes (`<32 hex salt>:<128 hex key>`,
N=16384, r=16, p=1, dkLen=64). The browser hashes the password
(`hashPassword()` in `src/lib/neon.ts`) and the RPC stores the hash, so no
plaintext password ever reaches the database. Older bcrypt hashes cannot be
verified by Better Auth — use *Reset password* in the Employees screen to migrate
an account.

## Accounts

- Admins sign in with their real email or with a username (e.g. `admin@attendance-login.example.com`).
- Employees sign in with a **username**; the app appends
  `@attendance-login.example.com` before calling Neon Auth.
- New accounts are created from **Employees → Add Employee**: pick *Account type*
  (Employee or Administrator), and for an administrator enter the **email** they
  will sign in with.
- The account list shows both roles; use *Reset password* (key icon) to set a new
  password for anyone, including another admin.
- The first admin must exist in the database already.

### Adding an admin from the command line

```bash
node scripts/add-admin.mjs dhomdesign@gmail.com 'SomeStrongPassword!' "Dhom Design"
```

Re-running the same command with the same email **changes that admin's password**.
It signs in as an existing admin using `ADMIN_EMAIL` / `ADMIN_PASSWORD`, which must
be present in the shell or in the git-ignored `.env.local` (never in code):

```env
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=…
```

### QR code lifetime

Every QR code expires within **24 hours** (rotating codes expire within a minute).
There is no permanent option: a photographed permanent poster would allow check-in
from anywhere. For a printed poster use the **24-Hour QR** mode and reprint daily,
or press **Revoke QR Codes** if a code leaks.

## Deployment (Vercel)

1. Push this repository to GitHub.
2. Import the repo in Vercel (framework preset **Vite**, build `npm run build`,
   output `dist`).
3. Add `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL` for Production and Preview.
4. Register the deployment domain as a Neon Auth trusted origin:

   ```bash
   neon neon-auth domain add https://<project>.vercel.app
   neon neon-auth domain list
   ```

5. `vercel.json` rewrites every path to `index.html` so client-side routes work.

Without a registered origin, Neon Auth rejects browser sign-in requests from the
deployed domain.

## Verification

```bash
# ADMIN_EMAIL / ADMIN_PASSWORD must be set (shell or .env.local)
node scripts/e2e-neon.mjs              # auth + RPC + RLS + QR cap/revoke checks
node scripts/ui-login.mjs admin 'the-password' out.png
```

`scripts/` also contains local helpers (`audit-neon.mjs`, `apply-sql.mjs`,
`cdp-check.mjs`, UI drivers). They are development tools, not part of the bundle.
