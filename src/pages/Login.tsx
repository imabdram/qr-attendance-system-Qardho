import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, NEON_DATA_API_URL, signIn, signOut, withTimeout } from '../lib/neon';
import { QrCode, LockKeyhole } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const slowTimer = useRef<number | null>(null);
  const nav = useNavigate();

  // Wake the database and the auth endpoint while the user is still typing: the
  // first request of the day can wait on a suspended Neon compute.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetch(`${NEON_DATA_API_URL}/profiles?select=id&limit=1`, {
        headers: { Accept: 'application/json' },
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setSlow(false);
    setError('');
    if (slowTimer.current) window.clearTimeout(slowTimer.current);
    slowTimer.current = window.setTimeout(() => setSlow(true), 8000);

    const loginValue = email.trim().toLowerCase();
    const loginEmail = loginValue.includes('@')
      ? loginValue
      : `${loginValue}@attendance-login.example.com`;

    try {
      const { user, error: authErr } = await signIn(loginEmail, password);

      if (authErr || !user) {
        const isNetworkIssue = authErr && /timed out|failed to fetch|network/i.test(authErr);
        setError(
          isNetworkIssue
            ? authErr
            : 'Incorrect username/email or password.'
        );
        return;
      }

      let p: { role: string; is_active: boolean } | null = null;
      let pErr: unknown = null;
      try {
        const res = await withTimeout(
          fetchProfile(user.id),
          15_000,
          'Loading your profile timed out.'
        );
        p = (res.data as { role: string; is_active: boolean } | null) ?? null;
        pErr = res.error;
      } catch (err) {
        setError(
          `Signed in, but your profile did not load (${(err as Error).message}). ` +
            'Check your connection and try again.'
        );
        return;
      }

      if (pErr || !p) {
        setError(
          'User authenticated, but no profile was found in the database. Please ensure your admin profile row exists in public.profiles table.'
        );
        await signOut();
        return;
      }

      if (!p.is_active) {
        setError('This account has been deactivated. Please contact an administrator.');
        await signOut();
        return;
      }

      nav(p.role === 'admin' ? '/admin' : '/employee');
    } finally {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      setSlow(false);
      setBusy(false);
    }
  };

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <QrCode size={30} />
        </div>
        <p className="eyebrow">QARDHO BRANCH · EMPLOYEE MANAGEMENT</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to record or manage attendance.</p>
        <label>
          Username or admin email
          <input
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your username"
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy ? (
            slow ? (
              'Still signing in…'
            ) : (
              'Signing in…'
            )
          ) : (
            <>
              <LockKeyhole size={17} /> Sign in
            </>
          )}
        </button>
        {busy && slow && (
          <p className="tiny muted center">
            The first sign-in of the day can take a few seconds while the database wakes up.
          </p>
        )}
        <p className="tiny muted center">Your account must be created by the system administrator.</p>
      </form>
    </main>
  );
}

function fetchProfile(userId: string) {
  return db.from('profiles').select('role, is_active').eq('id', userId).maybeSingle();
}
