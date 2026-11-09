# QR Attendance System

A responsive Progressive Web App for employee **Time In only** using a rotating office QR code. Admins manage employee accounts, display the QR, monitor today's attendance and export date-filtered Excel workbooks (.xlsx).

## Technology
- React + TypeScript + Vite
- Supabase Auth + PostgreSQL + Row Level Security
- Supabase Edge Functions (server-side QR validation and attendance writes)
- `html5-qrcode` camera scanner and `qrcode.react` QR display
- Vite PWA plugin
- Default timezone: `Africa/Mogadishu`

## Important assumptions in this starter
- One office / one attendance location.
- One Time In record per employee per Mogadishu calendar day.
- Friday is treated as the weekly day off (no check-in is accepted and absent count is zero). Default late threshold is 08:00 Mogadishu time. Change `app_settings.late_after` to your office start time.
- Admin creates employee accounts. Employees sign in with a username and password. The backend creates an internal non-delivery Auth email (`username@attendance-login.example.com`) so employees do not need personal email addresses. Admin signs in using the real email of the initial Auth account.
- QR token is refreshed on the admin display every 25 seconds and expires after 45 seconds.
- A valid token can be used by multiple employees during its short lifetime. A unique database constraint prevents duplicate daily check-ins.

## 1. Create Supabase project
1. Create a project at https://supabase.com.
2. Open **SQL Editor** and run `supabase/migrations/001_initial_schema.sql`.
3. In **Authentication → Users**, create your first administrator with an email and password.
4. Copy that user's UUID and run the following SQL, replacing the values:

```sql
insert into public.profiles (id, full_name, employee_number, username, role, is_active)
values ('ADMIN-AUTH-USER-UUID', 'System Administrator', 'ADMIN-001', 'admin@yourcompany.com', 'admin', true);
```

The UUID must be the ID of the Auth user you just created. Set the admin profile username to a unique value. The admin can sign in using the actual email address used to create the initial Auth account.

## 2. Configure and deploy Edge Functions
Install the Supabase CLI and log in:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Set the required secrets (use the values from Supabase Project Settings → API):

```bash
npx supabase secrets set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
npx supabase secrets set SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Deploy all three functions:

```bash
npx supabase functions deploy create-qr-token
npx supabase functions deploy scan-attendance
npx supabase functions deploy admin-create-employee
```

Never put the service-role key in the frontend or in a `VITE_` variable. It belongs only in Supabase Edge Function secrets.

## 3. Configure the frontend
Copy `.env.example` to `.env.local` and fill in the Supabase project URL and **anon/public** key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Then run:

```bash
npm install
npm run dev
```

For production:

```bash
npm run build
```

Deploy the generated `dist/` directory to Vercel or another static host. Set the two `VITE_` environment variables in the hosting dashboard. Configure SPA rewrites so all app routes serve `index.html`.

## 4. First use
1. Sign in with the administrator account.
2. Open **Employees → Add employee**. Enter full name, employee ID, username and a temporary password (minimum 8 characters). Usernames may contain letters, numbers, dots, underscores and hyphens.
3. Give the employee their login email and temporary password securely.
4. Open **QR Display** on a screen at the office entrance. Keep the display awake and brightness high.
5. Employee opens the website on their phone, signs in and scans the current QR.
6. The dashboard updates when the attendance row is inserted. Reports can be filtered and exported.

Camera scanning requires HTTPS (or localhost during development). On iPhone, use Safari's **Add to Home Screen**; on Android, use the browser's **Install app** option when offered.

## 5. Configure work start / late time
Default threshold is 08:00. Example to change to 07:30:

```sql
update public.app_settings
set setting_value = '07:30', updated_at = now()
where setting_key = 'late_after';
```

## Security notes and production hardening
- RLS protects profile and attendance reads. Browser clients cannot insert attendance or read QR token hashes.
- Edge Functions validate the signed-in user and role. Attendance time and work date are generated server-side.
- QR token contents are random 256-bit values; only their SHA-256 hashes are stored in the database.
- A rotating QR prevents old screenshots from being reused after expiry, but **does not prove physical presence** against a person who relays a live QR to someone elsewhere. For stronger presence assurance, add office geofencing, a managed kiosk, or office-network verification, and rate limiting.
- Before real company deployment, restrict CORS to your production domain, enable Supabase Auth rate limits, require strong passwords, arrange password resets, create backups, and test recovery procedures.
- Excel exports are real `.xlsx` workbooks. Future enhancements can add monthly absence summaries, multiple branches and configurable shifts.
# qr-attendance-system-Qardho
