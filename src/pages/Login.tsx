import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, signIn, signOut } from '../lib/neon';
import { QrCode, LockKeyhole } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const loginValue = email.trim().toLowerCase();
    const loginEmail = loginValue.includes('@')
      ? loginValue
      : `${loginValue}@attendance-login.example.com`;

    const { user, error: authErr } = await signIn(loginEmail, password);

    if (authErr || !user) {
      setError('Incorrect username/email or password.');
      setBusy(false);
      return;
    }

    const { data: p, error: pErr } = await db
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (pErr || !p) {
      setError(
        'User authenticated, but no profile was found in the database. Please ensure your admin profile row exists in public.profiles table.'
      );
      await signOut();
      setBusy(false);
      return;
    }

    if (!p.is_active) {
      setError('This account has been deactivated. Please contact an administrator.');
      await signOut();
      setBusy(false);
      return;
    }

    nav(p.role === 'admin' ? '/admin' : '/employee');
    setBusy(false);
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
            'Signing in…'
          ) : (
            <>
              <LockKeyhole size={17} /> Sign in
            </>
          )}
        </button>
        <p className="tiny muted center">Your account must be created by the system administrator.</p>
      </form>
    </main>
  );
}
