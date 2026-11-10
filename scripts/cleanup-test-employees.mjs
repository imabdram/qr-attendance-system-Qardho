/**
 * Deletes leftover QA/UI test accounts (usernames starting with ui/qa test prefixes).
 * Usage: node scripts/cleanup-test-employees.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal, adminCredentials } from './lib/admin.mjs';

loadEnvLocal();

const AUTH = process.env.VITE_NEON_AUTH_URL.replace(/\/$/, '');
const API = process.env.VITE_NEON_DATA_API_URL.replace(/\/rest\/v1\/?$/, '');
const ADMIN = adminCredentials();

const res = await fetch(`${AUTH}/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
  body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
});
const cookie = res.headers.getSetCookie()[0].split(';')[0];
const { token } = await (await fetch(`${AUTH}/token`, { headers: { Origin: 'http://localhost:5173', Cookie: cookie } })).json();

const db = createClient(API, 'neon-data-api', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  accessToken: async () => token,
});

const { data: rows, error } = await db
  .from('profiles')
  .select('id,username,full_name,role')
  .or('username.ilike.uitest%,username.ilike.qatest%,username.ilike.qaflow%');
if (error) throw new Error(error.message);

console.log('candidates:', JSON.stringify(rows));
for (const row of rows ?? []) {
  if (row.role === 'admin') {
    console.log('skipping admin', row.username);
    continue;
  }
  const del = await db.rpc('admin_delete_employee', { p_employee_id: row.id });
  console.log(row.username, '->', del.data?.message ?? del.error?.message);
}
