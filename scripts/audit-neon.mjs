import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

// Minimal .env.local loader
const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

const sql = neon(process.env.DATABASE_URL_UNPOOLED);

async function main() {
  const tables = await sql`
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('public','neon_auth')
    order by 1,2;
  `;
  console.log('TABLES:', tables.map((t) => `${t.table_schema}.${t.table_name}`).join('\n  '));

  const funcs = await sql`
    select n.nspname as schema, p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','neon_auth')
    order by 1,2;
  `;
  console.log('\nFUNCTIONS:');
  for (const f of funcs) console.log(`  ${f.schema}.${f.name}(${f.args})`);

  const roles = await sql`select rolname from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','neondb_owner') order by 1;`;
  console.log('\nROLES:', roles.map((r) => r.rolname).join(', '));

  const cols = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public'
    order by table_name, ordinal_position;
  `;
  console.log('\nPUBLIC COLUMNS:');
  let cur = '';
  for (const c of cols) {
    if (c.table_name !== cur) { cur = c.table_name; console.log(`  ${cur}:`); }
    console.log(`    ${c.column_name} ${c.data_type}`);
  }

  const policies = await sql`
    select tablename, policyname, cmd, roles::text as roles
    from pg_policies where schemaname='public' order by 1,2;
  `;
  console.log('\nRLS POLICIES:');
  for (const p of policies) console.log(`  ${p.tablename} | ${p.policyname} | ${p.cmd} | ${p.roles}`);

  const rls = await sql`
    select relname, relrowsecurity, relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1;
  `;
  console.log('\nRLS ENABLED:', rls.map((r) => `${r.relname}=${r.relrowsecurity}`).join(', '));

  try {
    const users = await sql`select id, email, name, "emailVerified" from neon_auth.user order by "createdAt" limit 20;`;
    console.log('\nNEON_AUTH USERS:');
    for (const u of users) console.log(`  ${u.id} | ${u.email} | ${u.name} | verified=${u.emailVerified}`);
  } catch (e) { console.log('\nNEON_AUTH USERS: error', e.message); }

  try {
    const profiles = await sql`select id, full_name, username, role, is_active from public.profiles order by created_at;`;
    console.log('\nPROFILES:');
    for (const p of profiles) console.log(`  ${p.id} | ${p.username} | ${p.full_name} | ${p.role} | active=${p.is_active}`);
  } catch (e) { console.log('\nPROFILES: error', e.message); }

  try {
    const settings = await sql`select setting_key, setting_value from public.app_settings order by 1;`;
    console.log('\nSETTINGS:', JSON.stringify(settings));
  } catch (e) { console.log('\nSETTINGS: error', e.message); }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
