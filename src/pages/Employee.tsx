import { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { recordAttendance } from '../lib/api';
import { db } from '../lib/neon';
import type { Profile, Attendance } from '../lib/types';
import { timeLocal, todayLocal, dateLabel } from '../lib/date';
import {
  Camera,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  History,
  CalendarCheck,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

export default function Employee({ profile }: { profile: Profile }) {
  const [activeTab, setActiveTab] = useState<'scanner' | 'history'>('scanner');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'success' | 'error' | ''>('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [recorded, setRecorded] = useState('');
  const [todayRecord, setTodayRecord] = useState<Attendance | null>(null);

  const [history, setHistory] = useState<Attendance[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const busyRef = useRef(false);

  const loadData = async () => {
    setLoadingHistory(true);
    try {
      const [{ data: todayData }, { data: historyData }] = await Promise.all([
        db
          .from('attendance')
          .select('*')
          .eq('employee_id', profile.id)
          .eq('work_date', todayLocal())
          .maybeSingle(),
        db
          .from('attendance')
          .select('*')
          .eq('employee_id', profile.id)
          .order('work_date', { ascending: false }),
      ]);

      if (todayData) {
        setDone(true);
        setTodayRecord(todayData as Attendance);
        setRecorded(todayData.time_in);
        setMessage('Your attendance was recorded today.');
        setKind('success');
      }

      setHistory((historyData || []) as Attendance[]);
    } catch (e) {
      console.error('Error loading employee attendance:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (done || activeTab !== 'scanner') return;
    const scanner = new Html5QrcodeScanner(
      'reader',
      {
        fps: 10,
        qrbox: { width: 230, height: 230 },
        rememberLastUsedCamera: true,
        aspectRatio: 1.0,
      },
      false
    );

    scanner.render(
      async (decoded) => {
        if (busyRef.current || done) return;
        busyRef.current = true;
        setBusy(true);
        try {
          const res = await recordAttendance(decoded);
          if (!res?.success) {
            throw new Error(res?.message || 'Attendance could not be recorded.');
          }
          setMessage(res.message || 'Your attendance has been recorded.');
          setKind('success');
          setRecorded(res.time_in || '');
          setDone(true);
          await scanner.clear();
          await loadData();
        } catch (e: any) {
          setMessage(e.message || 'Invalid or expired QR code. Please scan the current office QR.');
          setKind('error');
          setTimeout(() => {
            busyRef.current = false;
            setBusy(false);
          }, 2000);
        }
      },
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
    };
  }, [done, activeTab]);

  const presentCount = history.filter((h) => h.status === 'present').length;
  const lateCount = history.filter((h) => h.status === 'late').length;

  return (
    <main className="page employee-page">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">QARDHO BRANCH · EMPLOYEE PORTAL</p>
          <h1>Hello, {profile.full_name.split(' ')[0]}</h1>
          <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
            <span>@{profile.username} · {profile.employee_number}</span>
            <span className={`shift-badge ${profile.shift || 'morning'}`}>
              {(profile.shift || 'morning') === 'afternoon' ? 'Afternoon Shift (Late after 4:30 PM)' : 'Morning Shift (Late after 9:00 AM)'}
            </span>
          </p>
        </div>
        <div className="avatar">{profile.full_name.slice(0, 1).toUpperCase()}</div>
      </div>

      {/* Navigation Tabs */}
      <div className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
          onClick={() => setActiveTab('scanner')}
        >
          <Camera size={16} /> QR Check-in
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('history');
            loadData();
          }}
        >
          <History size={16} /> My Attendance ({history.length})
        </button>
      </div>

      {activeTab === 'scanner' && (
        <section className="scan-card">
          <div className="scan-heading">
            <span className="soft-icon">
              <Camera />
            </span>
            <div>
              <h2>{done ? "Today's Status" : 'Scan office QR code'}</h2>
              <p className="muted">
                {done ? 'Attendance already submitted for today' : 'Allow camera access when prompted.'}
              </p>
            </div>
          </div>

          {done ? (
            <div className="success-panel">
              <CheckCircle2 size={44} />
              <h2>Attendance Recorded!</h2>
              <p>{message}</p>
              <div className="recorded-time">
                <Clock3 size={18} />
                <strong>{recorded ? timeLocal(recorded) : 'Recorded'}</strong>
                <span>
                  {todayRecord?.status ? (
                    <span className={`status ${todayRecord.status}`}>
                      {todayRecord.status === 'late' ? 'Late Arrival' : 'On Time (Present)'}
                    </span>
                  ) : (
                    'Mogadishu time'
                  )}
                </span>
              </div>
              <button
                className="secondary"
                style={{ marginTop: '14px' }}
                onClick={() => setActiveTab('history')}
              >
                View full attendance history →
              </button>
            </div>
          ) : (
            <>
              <div id="reader" className="qr-reader" />
              <div className="scan-hint">
                <ShieldCheck size={17} /> Only a valid, active office QR code is accepted.
              </div>
            </>
          )}

          {message && !done && <div className={`alert ${kind}`}>{message}</div>}
        </section>
      )}

      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary Cards */}
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card">
              <span className="stat-icon blue">
                <CalendarCheck size={20} />
              </span>
              <div>
                <p className="muted">Total Days</p>
                <strong>{history.length}</strong>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon green">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <p className="muted">Present</p>
                <strong>{presentCount}</strong>
              </div>
            </div>
            <div className="stat-card">
              <span className="stat-icon amber">
                <AlertTriangle size={20} />
              </span>
              <div>
                <p className="muted">Late Arrivals</p>
                <strong>{lateCount}</strong>
              </div>
            </div>
          </div>

          {/* History Records Table */}
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Your Attendance Records</h2>
                <p className="muted">Complete record of your scanned arrivals.</p>
              </div>
              <button className="secondary" onClick={loadData}>
                <RotateCcw size={15} /> Refresh
              </button>
            </div>

            {loadingHistory ? (
              <p className="muted center" style={{ padding: '24px' }}>
                Loading records…
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time In</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="empty">
                          No attendance records found yet.
                        </td>
                      </tr>
                    ) : (
                      history.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{dateLabel(item.work_date)}</strong>
                            {item.work_date === todayLocal() && (
                              <span
                                style={{
                                  marginLeft: '8px',
                                  fontSize: '10px',
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  padding: '2px 6px',
                                  borderRadius: '10px',
                                  fontWeight: 700,
                                }}
                              >
                                Today
                              </span>
                            )}
                          </td>
                          <td>{timeLocal(item.time_in)}</td>
                          <td>
                            <span className={`status ${item.status}`}>
                              {item.status === 'late' ? 'Late' : 'Present'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <p className="tiny muted center" style={{ marginTop: '20px' }}>
        Verified Mogadishu Server Time (UTC+3)
      </p>
    </main>
  );
}
