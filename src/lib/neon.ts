import { createAuthClient } from '@neon/auth';
import { createClient } from '@supabase/supabase-js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

/**
 * Neon backend configuration.
 *
 * - Neon Auth (Managed Better Auth) handles sign-in / sessions and issues the JWT.
 * - The Neon Data API is PostgREST-compatible, so the Supabase data client is used
 *   purely as a transport; every request carries the Neon Auth JWT via `accessToken`.
 */
const DEFAULT_AUTH_URL =
  'https://ep-icy-sound-za5lczjb.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';
const DEFAULT_DATA_API_URL =
  'https://ep-icy-sound-za5lczjb.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1';

/**
 * Environment values are pasted by hand into Vercel, so treat a malformed value
 * (truncated host, missing path) as absent instead of shipping a broken client.
 */
function sanitizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('http')) return fallback;
  try {
    const url = new URL(value);
    if (url.hostname.endsWith('.') || url.hostname.length < 4) return fallback;
    if (url.pathname.replace(/\/$/, '') === '') return fallback;
    return value.replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

const rawAuthUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
const rawDataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined;

export const NEON_AUTH_URL = sanitizeUrl(rawAuthUrl, DEFAULT_AUTH_URL);
export const NEON_DATA_API_URL = sanitizeUrl(rawDataApiUrl, DEFAULT_DATA_API_URL);

if (rawAuthUrl && rawAuthUrl !== NEON_AUTH_URL) {
  console.warn('Ignoring malformed VITE_NEON_AUTH_URL, using the default Neon Auth endpoint.');
}
if (rawDataApiUrl && rawDataApiUrl !== NEON_DATA_API_URL) {
  console.warn('Ignoring malformed VITE_NEON_DATA_API_URL, using the default Neon Data API endpoint.');
}

/** supabase-js appends `/rest/v1` itself, so strip it from the configured base. */
const DATA_API_BASE = NEON_DATA_API_URL.replace(/\/rest\/v1\/?$/, '');

export const isBackendConfigured = Boolean(
  NEON_AUTH_URL && DATA_API_BASE && NEON_AUTH_URL.startsWith('http') && DATA_API_BASE.startsWith('http')
);

/** Native Better Auth client exposed by Neon Auth (signIn.email, getSession, signOut, …). */
export const auth = createAuthClient(NEON_AUTH_URL);

export type AuthUser = { id: string; email?: string; name?: string };

let currentUser: AuthUser | null = null;
const listeners = new Set<(user: AuthUser | null) => void>();

/** Subscribe to sign-in / sign-out changes. Fires immediately with the current user. */
export function onAuthChange(listener: (user: AuthUser | null) => void): () => void {
  listeners.add(listener);
  listener(currentUser);
  return () => listeners.delete(listener);
}

function setUser(user: AuthUser | null) {
  currentUser = user;
  listeners.forEach((listener) => listener(user));
}

const AUTH_BASE = NEON_AUTH_URL.replace(/\/$/, '');

let jwtCache: { token: string; exp: number } | null = null;

/**
 * Returns the short-lived JWT that the Neon Data API accepts.
 * Neon Auth exposes it at `GET /token` (Better Auth JWT plugin); the session
 * cookie is sent automatically because the call is credentialed.
 */
export async function getJwt(): Promise<string | null> {
  // No session yet: skip the request instead of provoking a 401.
  if (!currentUser) return null;
  if (jwtCache && jwtCache.exp * 1000 - 30_000 > Date.now()) {
    return jwtCache.token;
  }
  try {
    const res = await fetch(`${AUTH_BASE}/token`, { credentials: 'include' });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token?: string };
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    jwtCache = { token, exp: Number(payload.exp) || 0 };
    return token;
  } catch {
    return null;
  }
}

/**
 * PostgREST client pointed at the Neon Data API. Row Level Security still applies:
 * the JWT identifies the signed-in user, so `auth.uid()` and the `is_admin()` checks
 * inside the database functions keep working.
 */
export const db = createClient(DATA_API_BASE, 'neon-data-api', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  accessToken: async () => getJwt(),
});

/** Sign in with the internal attendance email + password. */
export async function signIn(
  email: string,
  password: string
): Promise<{ user: AuthUser | null; error: string | null }> {
  jwtCache = null;
  const { data, error } = await (auth.signIn.email({ email, password }) as Promise<{
    data: { user?: AuthUser } | null;
    error: { message?: string } | null;
  }>);

  if (error) {
    return { user: null, error: error.message || 'Sign in failed.' };
  }

  const user = data?.user ?? (await getSessionUser());
  setUser(user);
  return { user, error: null };
}

export async function signOut(): Promise<void> {
  try {
    await auth.signOut();
  } finally {
    jwtCache = null;
    setUser(null);
  }
}

/** Reads the persisted Neon Auth session (survives page reloads). */
export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const { data } = (await auth.getSession()) as {
      data: { user?: AuthUser; session?: { user?: AuthUser } } | null;
    };
    return data?.user ?? data?.session?.user ?? null;
  } catch {
    return null;
  }
}

/** Restores the session on boot and notifies subscribers. */
export async function restoreSession(): Promise<AuthUser | null> {
  const user = await getSessionUser();
  setUser(user);
  return user;
}

/**
 * Hash a password exactly the way Better Auth (Neon Auth) does, so the hash can be
 * stored by the `admin_create_user` / `admin_reset_password` database functions.
 * Format: `<32 hex salt>:<128 hex scrypt key>` (N=16384, r=16, p=1, dkLen=64).
 */
export async function hashPassword(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const key = await scryptAsync(password.normalize('NFKC'), salt, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2,
  });
  const hash = Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hash}`;
}
