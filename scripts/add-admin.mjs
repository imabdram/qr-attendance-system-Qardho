/**
 * Create an administrator (or reset an existing admin's password).
 *
 *   node scripts/add-admin.mjs <email> <password> ["Full Name"] [username]
 *
 * Example:
 *   node scripts/add-admin.mjs name@example.com 'A-Strong-Password' "Full Name"
 *
 * Running it again with the same email sets a new password.
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD of an existing administrator
 * (set them in the shell or in the git-ignored .env.local).
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal, adminCredentials } from './lib/admin.mjs';

loadEnvLocal();

const [email, password, fullName, usernameArg] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/add-admin.mjs <email> <password> ["Full Name"] [username]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
const username = (usernameArg || local).toLowerCase();
const name = fullName || local;
const phone = 'ADMIN-' + username.toUpperCase();

const hashPassword = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }).toString('hex')}`;
};

const AUTH = process.env.VITE_NEON_AUTH_URL.replace(/\/$/, '');
const API = process.env.VITE_NEON_DATA_API_URL.replace(/\/rest\/v1\/?$/, '');
const ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173';

async function signIn(e, p) {
  const res = await fetch(`${AUTH}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: e, password: p }),
  });
  if (!res.ok) throw new Error(`Admin sign-in failed (${res.status})`);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const { token } = await (await fetch(`${AUTH}/token`, { headers: { Origin: ORIGIN, Cookie: cookie } })).json();
  return createClient(API, 'neon-data-api', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => token,
  });
}

const ADMIN = adminCredentials();
const admin = await signIn(ADMIN.email, ADMIN.password);

const created = await admin.rpc('admin_create_user', {
  p_full_name: name,
  p_employee_number: phone,
  p_username: username,
  p_password_hash: hashPassword(password),
  p_role: 'admin',
  p_shift: 'morning',
  p_department: 'Management',
  p_email: email,
});

if (created.error) {
  console.error('Failed:', created.error.message);
  process.exit(1);
}

if (created.data?.success) {
  console.log(`Admin created: ${email} (username ${username})`);
  console.log(`Password set to: ${password}`);
} else {
  const msg = String(created.data?.message || '');
  if (!/already exists|already taken|already registered/i.test(msg)) {
    console.error('Failed:', msg);
    process.exit(1);
  }
  console.log('Account already exists — updating its password instead…');
  const { data: rows, error } = await admin
    .from('profiles')
    .select('id,username,role')
    .eq('username', username)
    .maybeSingle();
  if (error || !rows) {
    console.error('Could not find the existing profile for', username, error?.message ?? '');
    process.exit(1);
  }
  const reset = await admin.rpc('admin_reset_password', {
    p_employee_id: rows.id,
    p_password_hash: hashPassword(password),
  });
  if (!reset.data?.success) {
    console.error('Failed to set password:', reset.data?.message ?? reset.error?.message);
    process.exit(1);
  }
  console.log(`Password updated for ${email} (username ${username}).`);
}

const check = await admin.from('profiles').select('id,username,role,is_active').eq('username', username).maybeSingle();
console.log('Profile:', JSON.stringify(check.data));
