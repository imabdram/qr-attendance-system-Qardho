import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import {
  isBackendConfigured,
  loadProfile,
  onAuthChange,
  restoreSession,
  setUnauthorizedHandler,
  signOut as endSession,
} from './lib/neon';
import type { Profile } from './lib/types';
import Login from './pages/Login';
import Admin from './pages/Admin';
import Employee from './pages/Employee';
import { QrCode, LayoutDashboard, Users, LogOut, ClipboardList, AlertCircle } from 'lucide-react';

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;

    if (!isBackendConfigured) {
      setLoading(false);
      return;
    }

    const load = async (user: { id: string } | null) => {
      if (!user) {
        if (alive) setProfile(null);
        return;
      }
      try {
        const row = await loadProfile(user.id);
        if (alive) setProfile(row as Profile | null);
      } catch (e) {
        console.error('Profile load error:', e);
      }
    };

    restoreSession()
      .then((user) => load(user))
      .catch((e) => console.error('Session load error:', e))
      .finally(() => {
        if (alive) setLoading(false);
      });

    const unsubscribe = onAuthChange((user) => {
      if (alive) load(user);
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  // A 401 from the Data API means the JWT/session is gone: drop it and ask to sign in again.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void endSession();
      setProfile(null);
      nav('/login?expired=1');
    });
    return () => setUnauthorizedHandler(null);
  }, [nav]);

  const signOut = async () => {
    await endSession();
    setProfile(null);
    nav('/login');
  };

  if (!isBackendConfigured) {
    return (
      <main className="login-wrap">
        <div className="login-card" style={{ maxWidth: '540px' }}>
          <div className="login-logo" style={{ background: '#fff1f1', color: '#b91c1c' }}>
            <AlertCircle size={30} />
          </div>
          <p className="eyebrow" style={{ color: '#b91c1c' }}>SETUP REQUIRED</p>
          <h1>Connect to Neon</h1>
          <p className="muted">
            The app needs your Neon Auth URL and Data API URL to sign users in and record attendance.
          </p>
          <div className="alert" style={{ background: '#f7f8fa', color: '#3f1d22', fontSize: '12px', lineHeight: '1.6' }}>
            <strong>Step 1:</strong> Open your Neon project &rarr; <strong>Auth</strong> / <strong>Data API</strong><br />
            <strong>Step 2:</strong> Copy both endpoint URLs<br />
            <strong>Step 3:</strong> Put them in a <code>.env.local</code> file in this project:
            <pre style={{ margin: '8px 0 0', padding: '10px', background: '#111827', color: '#f5d9d9', borderRadius: '8px', overflowX: 'auto', fontSize: '11px' }}>
              VITE_NEON_AUTH_URL=https://…/neondb/auth&#10;VITE_NEON_DATA_API_URL=https://…/neondb/rest/v1
            </pre>
          </div>
          <p className="tiny muted">
            Once saved, restart the Vite dev server to load the new configuration.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return <div className="center-screen">Loading attendance portal…</div>;
  }

  return (
    <>
      {profile && (
        <header className="topbar">
          <Link to={profile.role === 'admin' ? '/admin' : '/employee'} className="brand">
            <span className="brand-icon">
              <QrCode size={21} />
            </span>{' '}
            Qardho Attendance Portal
          </Link>
          <div className="top-actions">
            <span className="user-chip">
              {profile.full_name} · {profile.role}
            </span>
            <button className="icon-btn" onClick={signOut} title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
      )}

      <Routes>
        <Route
          path="/login"
          element={profile ? <Navigate to={profile.role === 'admin' ? '/admin' : '/employee'} /> : <Login />}
        />
        <Route
          path="/"
          element={<Navigate to={profile ? (profile.role === 'admin' ? '/admin' : '/employee') : '/login'} />}
        />
        <Route
          path="/admin/*"
          element={profile?.role === 'admin' ? <Admin profile={profile} /> : <Navigate to="/login" />}
        />
        <Route
          path="/employee"
          element={profile?.role === 'employee' ? <Employee profile={profile} /> : <Navigate to="/login" />}
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>

      {profile?.role === 'admin' && (
        <nav className="bottom-nav">
          <Link to="/admin">
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
          <Link to="/admin/employees">
            <Users size={18} />
            Employees
          </Link>
          <Link to="/admin/qr">
            <QrCode size={18} />
            QR Display
          </Link>
          <Link to="/admin/reports">
            <ClipboardList size={18} />
            Reports
          </Link>
        </nav>
      )}
    </>
  );
}
