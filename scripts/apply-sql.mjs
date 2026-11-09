import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from '@neondatabase/serverless';

// Minimal .env.local loader (no extra dependency)
const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-sql.mjs <path-to-sql-file>');
  process.exit(1);
}

const sqlText = readFileSync(resolve(process.cwd(), file), 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED });

try {
  await pool.query(sqlText);
  console.log(`Applied ${file}`);
} catch (err) {
  console.error(`Failed to apply ${file}:`, err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
