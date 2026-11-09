/**
 * End-to-end check against the live Neon backend, mirroring what the SPA does:
 * Neon Auth sign-in -> JWT -> Data API tables/RPCs.
 *
 *   node scripts/e2e-neon.mjs
 */
import { readFileSync } from 'node:fs';
import { scryptSync, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

const AUTH = process.env.VITE_NEON_AUTH_URL.replace(/\/$/, '');
const API = process.env.VITE_NEON_DATA_API_URL.replace(/\/rest\/v1\/?$/, '');
const ORIGIN = 'http://localhost:5173';
const ADMIN = { email: 'admin@attendance-login.example.com', password: 'AdminPassword123!' };
const TEST = {
  username: 'qaflow' + Date.now().toString().slice(-6),
  password: 'FlowPass123!',
  fullName: 'QA Flow Employee',
  phone: 'QA-' + Date.now().toString().slice(-6),
};

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }).toString('hex')}`;
};

async function signIn(email, password) {
  const res = await fetch(`${AUTH}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status}) for ${email}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const tok = await fetch(`${AUTH}/token`, { headers: { Origin: ORIGIN, Cookie: cookie } });
  const { token } = await tok.json();
  const db = createClient(API, 'neon-data-api', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
  return { token, db, cookie };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

let createdId = null;
try {
  const admin = await signIn(ADMIN.email, ADMIN.password);
  check('admin Neon Auth sign-in', Boolean(admin.token));

  const me = await admin.db.from('profiles').select('id,role,username').eq('id', 'a2d02e4c-7675-47fd-8c10-32ab9c0d1c61').maybeSingle();
  check('admin profile readable through Data API (RLS)', me.data?.role === 'admin', JSON.stringify(me.data));

  const created = await admin.db.rpc('admin_create_user', {
    p_full_name: TEST.fullName,
    p_employee_number: TEST.phone,
    p_username: TEST.username,
    p_password_hash: hashPassword(TEST.password),
    p_role: 'employee',
    p_shift: 'morning',
    p_department: 'QA',
  });
  createdId = created.data?.id ?? null;
  check('admin_create_user RPC', created.data?.success === true, created.data?.message ?? created.error?.message);

  const emp = await signIn(`${TEST.username}@attendance-login.example.com`, TEST.password);
  check('new employee can sign in with scrypt password', Boolean(emp.token));

  const qr = await admin.db.rpc('create_qr_token', { p_duration_seconds: 45 });
  check('create_qr_token RPC', Boolean(qr.data?.token), qr.data?.expires_at ?? qr.error?.message);

  const scan = await emp.db.rpc('scan_attendance', { p_token: qr.data?.token });
  check('employee scan_attendance RPC', scan.data?.success === true, scan.data?.message);

  const dup = await emp.db.rpc('scan_attendance', { p_token: qr.data?.token });
  check('duplicate scan blocked', dup.data?.success === false || dup.data?.already_recorded === true, dup.data?.message);

  const empRows = await emp.db.from('attendance').select('*, profiles!attendance_employee_id_fkey(full_name,employee_number)');
  check(
    'employee sees own attendance with embedded profile',
    Array.isArray(empRows.data) && empRows.data.length === 1 && empRows.data[0].profiles?.full_name === TEST.fullName,
    JSON.stringify(empRows.error?.message ?? empRows.data?.[0]?.profiles)
  );

  const adminRows = await admin.db.from('attendance').select('*, profiles!attendance_employee_id_fkey(full_name,employee_number)').order('time_in');
  check('admin dashboard query', Array.isArray(adminRows.data) && adminRows.data.some((r) => r.employee_id === createdId), adminRows.error?.message);

  const upsert = await admin.db.from('app_settings').upsert({ setting_key: 'late_after_morning', setting_value: '09:00', updated_at: new Date().toISOString() });
  check('threshold upsert (app_settings)', !upsert.error, upsert.error?.message);

  const reset = await admin.db.rpc('admin_reset_password', { p_employee_id: createdId, p_password_hash: hashPassword('NewFlowPass123!') });
  check('admin_reset_password RPC', reset.data?.success === true, reset.data?.message);

  const relogin = await signIn(`${TEST.username}@attendance-login.example.com`, 'NewFlowPass123!');
  check('employee signs in with reset password', Boolean(relogin.token));

  const upd = await admin.db.rpc('admin_update_employee', {
    p_employee_id: createdId,
    p_full_name: TEST.fullName + ' X',
    p_employee_number: TEST.phone,
    p_department: 'QA2',
    p_shift: 'afternoon',
  });
  check('admin_update_employee RPC', upd.data?.success === true, upd.data?.message);
} catch (err) {
  check('unexpected error', false, err.message);
} finally {
  if (createdId) {
    const admin = await signIn(ADMIN.email, ADMIN.password);
    const del = await admin.db.rpc('admin_delete_employee', { p_employee_id: createdId });
    check('cleanup admin_delete_employee', del.data?.success === true, del.data?.message);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
