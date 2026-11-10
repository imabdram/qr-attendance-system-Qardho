import { readFileSync } from 'node:fs';

/** Loads .env.local (if present) without overwriting real environment variables. */
export function loadEnvLocal() {
  try {
    const envText = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[m[1]] ??= v;
    }
  } catch {
    // .env.local is optional; CI supplies real environment variables.
  }
}

/**
 * Credentials of an existing administrator, used by the maintenance scripts.
 * Never hardcode these: set ADMIN_EMAIL / ADMIN_PASSWORD in the shell or in
 * the git-ignored .env.local.
 */
export function adminCredentials() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      'Missing admin credentials. Set ADMIN_EMAIL and ADMIN_PASSWORD in the shell\n' +
        'or in .env.local (git-ignored). Example:\n' +
        '  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=… node scripts/e2e-neon.mjs'
    );
    process.exit(1);
  }
  return { email, password };
}
