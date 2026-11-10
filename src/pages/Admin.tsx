import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { db } from '../lib/neon';
import {
  generateQrToken,
  revokeQrTokens,
  createEmployeeAccount,
  adminDeleteEmployee,
  adminResetPassword,
  adminUpdateEmployee,
} from '../lib/api';
import type { Attendance, Profile } from '../lib/types';
import Notice from '../components/Notice';
import { todayLocal, timeLocal, dateLabel, isFridayLocal } from '../lib/date';
import {
  Users,
  UserCheck,
  UserX,
  Clock3,
  Plus,
  Download,
  RefreshCw,
  Search,
  RotateCw,
  Pin,
  Hand,
  Printer,
  Sparkles,
  Pencil,
  Trash2,
  KeyRound,
  ShieldCheck,
  X,
  Filter,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';

function Dashboard() {
  const [rows, setRows] = useState<Attendance[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [morningLateAt, setMorningLateAt] = useState('09:00');
  const [afternoonLateAt, setAfternoonLateAt] = useState('16:30');
  const [editingThreshold, setEditingThreshold] = useState<'morning' | 'afternoon' | null>(null);
  const [thresholdInput, setThresholdInput] = useState('09:00');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [error, setError] = useState('');
  const polling = useRef(false);

  const saveThreshold = async () => {
    if (!thresholdInput || !editingThreshold) return;
    setSavingThreshold(true);
    const key = editingThreshold === 'morning' ? 'late_after_morning' : 'late_after_afternoon';
    const { error: saveError } = await db
      .from('app_settings')
      .upsert({
        setting_key: key,
        setting_value: thresholdInput,
        updated_at: new Date().toISOString(),
      });
    if (saveError) {
      setError(saveError.message);
    } else {
      if (editingThreshold === 'morning') {
        setMorningLateAt(thresholdInput);
      } else {
        setAfternoonLateAt(thresholdInput);
      }
      setEditingThreshold(null);
      await load();
    }
    setSavingThreshold(false);
  };

  /** Today's arrivals only — this is what the 10s poll refreshes. */
  const loadAttendance = async (silent = false) => {
    if (polling.current) return;
    polling.current = true;
    if (!silent) setLoading(true);
    try {
      const { data, error: queryError } = await db
        .from('attendance')
        .select('*, profiles!attendance_employee_id_fkey(full_name,employee_number,department)')
        .eq('work_date', todayLocal())
        .order('time_in');

      if (queryError) {
        setError(queryError.message);
      } else {
        setRows((data || []) as any);
      }
    } catch (err) {
      setError((err as Error).message || 'Could not load attendance.');
    } finally {
      polling.current = false;
      if (!silent) setLoading(false);
    }
  };

  /** Staff list and late thresholds change rarely; load them on demand. */
  const loadReference = async () => {
    try {
      const { data: p, error: pError } = await db
        .from('profiles')
        .select('*')
        .eq('role', 'employee')
        .eq('is_active', true);
      if (pError) setError(pError.message);
      else setStaff((p || []) as Profile[]);

      const { data: s } = await db.from('app_settings').select('setting_key,setting_value');
      if (s) {
        const morn = s.find((x) => x.setting_key === 'late_after_morning')?.setting_value;
        const legacy = s.find((x) => x.setting_key === 'late_after')?.setting_value;
        const aft = s.find((x) => x.setting_key === 'late_after_afternoon')?.setting_value;
        if (morn) setMorningLateAt(morn);
        else if (legacy) setMorningLateAt(legacy);
        if (aft) setAfternoonLateAt(aft);
      }
    } catch (err) {
      setError((err as Error).message || 'Could not load settings.');
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    await Promise.all([loadAttendance(true), loadReference()]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Neon's Data API has no Realtime channel: refresh today's arrivals every 10s,
    // but skip while the tab is in the background.
    const interval = setInterval(() => {
      if (!document.hidden) void loadAttendance(true);
    }, 10000);
    const onVisible = () => {
      if (!document.hidden) void loadAttendance(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const filteredStaff = shiftFilter === 'all'
    ? staff
    : staff.filter((s) => (s.shift || 'morning') === shiftFilter);

  const filteredRows = shiftFilter === 'all'
    ? rows
    : rows.filter((r) => (r.shift || r.profiles?.shift || 'morning') === shiftFilter);

  const present = filteredRows.length;
  const late = filteredRows.filter((r) => r.status === 'late').length;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Attendance dashboard</h1>
          <p className="muted">
            {dateLabel(todayLocal())} ·{' '}
            {isFridayLocal() ? 'Weekly day off' : 'Live attendance monitoring'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value as any)}
            style={{
              border: '1px solid #dce5ee',
              borderRadius: '9px',
              padding: '9px 12px',
              fontSize: '12px',
              background: '#fff',
              color: '#374151',
              fontWeight: 700,
            }}
          >
            <option value="all">All Shifts</option>
            <option value="morning">Morning Shift</option>
            <option value="afternoon">Afternoon Shift</option>
          </select>
          <button className="secondary" onClick={() => load()}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>
      {error && (
        <Notice kind="error" onClose={() => setError('')}>
          {error}
        </Notice>
      )}
      <div className="stats-grid">
        <Stat
          icon={<Users />}
          label={shiftFilter === 'all' ? 'Active employees' : `${shiftFilter === 'morning' ? 'Morning' : 'Afternoon'} employees`}
          value={filteredStaff.length}
        />
        <Stat icon={<UserCheck />} label="Present today" value={present} tone="green" />
        <Stat icon={<Clock3 />} label="Late arrivals" value={late} tone="amber" />
        <Stat
          icon={<UserX />}
          label="Not checked in"
          value={isFridayLocal() ? 0 : Math.max(0, filteredStaff.length - present)}
          tone="red"
        />
      </div>
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <h2>Today's arrivals</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginTop: '6px' }}>
              {/* Morning Threshold */}
              {editingThreshold === 'morning' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="tiny" style={{ fontWeight: 700, color: '#b91c1c' }}>Morning late:</span>
                  <input
                    type="time"
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '6px',
                      border: '1px solid #dce5ee',
                      fontSize: '12px',
                    }}
                  />
                  <button
                    className="small-btn"
                    style={{ padding: '2px 8px' }}
                    disabled={savingThreshold}
                    onClick={saveThreshold}
                  >
                    {savingThreshold ? '…' : 'Save'}
                  </button>
                  <button
                    className="small-btn"
                    style={{ padding: '2px 8px' }}
                    onClick={() => setEditingThreshold(null)}
                  >
                    âœ•
                  </button>
                </div>
              ) : (
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span>Morning late: <strong style={{ color: '#b91c1c' }}>{morningLateAt}</strong></span>
                  <button
                    className="small-btn"
                    style={{ padding: '2px 7px', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => {
                      setThresholdInput(morningLateAt);
                      setEditingThreshold('morning');
                    }}
                  >
                    Change
                  </button>
                </span>
              )}

              {/* Afternoon Threshold */}
              {editingThreshold === 'afternoon' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span className="tiny" style={{ fontWeight: 700, color: '#c2410c' }}>Afternoon late:</span>
                  <input
                    type="time"
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '6px',
                      border: '1px solid #dce5ee',
                      fontSize: '12px',
                    }}
                  />
                  <button
                    className="small-btn"
                    style={{ padding: '2px 8px' }}
                    disabled={savingThreshold}
                    onClick={saveThreshold}
                  >
                    {savingThreshold ? '…' : 'Save'}
                  </button>
                  <button
                    className="small-btn"
                    style={{ padding: '2px 8px' }}
                    onClick={() => setEditingThreshold(null)}
                  >
                    âœ•
                  </button>
                </div>
              ) : (
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span>Afternoon late: <strong style={{ color: '#c2410c' }}>{afternoonLateAt}</strong></span>
                  <button
                    className="small-btn"
                    style={{ padding: '2px 7px', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => {
                      setThresholdInput(afternoonLateAt);
                      setEditingThreshold('afternoon');
                    }}
                  >
                    Change
                  </button>
                </span>
              )}
            </div>
          </div>
          <Link className="text-link" to="/admin/reports">
            View reports →
          </Link>
        </div>
        {loading ? <p className="muted">Loading records…</p> : <AttendanceTable rows={filteredRows} />}
      </section>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = 'blue',
}: {
  icon: any;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="stat-card">
      <span className={`stat-icon ${tone}`}>{icon}</span>
      <div>
        <p className="muted">{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AttendanceTable({ rows }: { rows: Attendance[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Phone Number</th>
            <th>Shift</th>
            <th>Time In</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                No attendance recorded yet today.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const shift = r.shift || r.profiles?.shift || 'morning';
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.profiles?.full_name || 'Employee'}</strong>
                  </td>
                  <td>{r.profiles?.employee_number || '—'}</td>
                  <td>
                    <span className={`shift-badge ${shift}`}>
                      {shift === 'afternoon' ? 'Afternoon' : 'Morning'}
                    </span>
                  </td>
                  <td>{timeLocal(r.time_in)}</td>
                  <td>
                    <span className={`status ${r.status}`}>
                      {r.status === 'late' ? 'Late' : 'Present'}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function AbsenceTable({ rows }: { rows: { date: string; employee: Profile }[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Employee</th>
            <th>Phone Number</th>
            <th>Shift</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                Nobody was absent in this range.
              </td>
            </tr>
          ) : (
            rows.map(({ date, employee }) => {
              const shift = employee.shift || 'morning';
              return (
                <tr key={`${date}-${employee.id}`}>
                  <td>{dateLabel(date)}</td>
                  <td>
                    <strong>{employee.full_name}</strong>
                  </td>
                  <td>{employee.employee_number || '—'}</td>
                  <td>
                    <span className={`shift-badge ${shift}`}>
                      {shift === 'afternoon' ? 'Afternoon' : 'Morning'}
                    </span>
                  </td>
                  <td>
                    <span className="status absent">Absent</span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Employees() {
  const [list, setList] = useState<Profile[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [q, setQ] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Simplified form: Name, Username, Phone Number, Shift (default: morning), Password
  const [form, setForm] = useState<{
    full_name: string;
    phone: string;
    username: string;
    password: string;
    shift: 'morning' | 'afternoon';
  }>({
    full_name: '',
    phone: '',
    username: '',
    password: '',
    shift: 'morning',
  });

  // Modal States
  const [editEmp, setEditEmp] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState<{
    full_name: string;
    phone: string;
    shift: 'morning' | 'afternoon';
  }>({ full_name: '', phone: '', shift: 'morning' });

  const [resetEmp, setResetEmp] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [deleteEmp, setDeleteEmp] = useState<Profile | null>(null);

  const load = async () => {
    const { data, error } = await db
      .from('profiles')
      .select('*')
      .eq('role', 'employee')
      .order('full_name');
    if (error) {
      setMsgType('error');
      setMsg(error.message);
      return;
    }
    setList((data || []) as Profile[]);
  };

  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const data = await createEmployeeAccount({
        full_name: form.full_name,
        employee_number: form.phone,
        username: form.username,
        role: 'employee',
        password: form.password,
        shift: form.shift,
      });
      setMsgType('success');
      setMsg(data.message || 'Employee account created successfully.');
      setForm({
        full_name: '',
        phone: '',
        username: '',
        password: '',
        shift: 'morning',
      });
      setShow(false);
      await load();
    } catch (err: any) {
      setMsgType('error');
      setMsg(err.message || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEmp) return;
    setBusy(true);
    setMsg('');
    try {
      const data = await adminUpdateEmployee(editEmp.id, {
        full_name: editForm.full_name,
        employee_number: editForm.phone || editEmp.employee_number,
        shift: editForm.shift,
      });
      setMsgType('success');
      setMsg(data.message || 'Employee updated successfully.');
      setEditEmp(null);
      await load();
    } catch (err: any) {
      setMsgType('error');
      setMsg(err.message || 'Could not update employee.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmp) return;
    setBusy(true);
    setMsg('');
    try {
      const data = await adminResetPassword(resetEmp.id, newPassword);
      setMsgType('success');
      setMsg(data.message || `Password reset for ${resetEmp.full_name}.`);
      setResetEmp(null);
      setNewPassword('');
    } catch (err: any) {
      setMsgType('error');
      setMsg(err.message || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteEmp) return;
    setBusy(true);
    setMsg('');
    try {
      const data = await adminDeleteEmployee(deleteEmp.id);
      setMsgType('success');
      setMsg(data.message || 'Employee deleted successfully.');
      setDeleteEmp(null);
      await load();
    } catch (err: any) {
      setMsgType('error');
      setMsg(err.message || 'Could not delete employee.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: Profile) => {
    const { error: toggleError } = await db
      .from('profiles')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (toggleError) {
      setMsgType('error');
      setMsg(toggleError.message);
    } else {
      setMsgType('success');
      setMsg(`${p.full_name} is now ${p.is_active ? 'deactivated' : 'active'}.`);
      await load();
    }
  };

  const filtered = list.filter((x) => {
    const matchQuery = (x.full_name + ' ' + x.employee_number + ' ' + (x.username || ''))
      .toLowerCase()
      .includes(q.toLowerCase());
    const matchShift = shiftFilter === 'all' || (x.shift || 'morning') === shiftFilter;
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && x.is_active) ||
      (statusFilter === 'inactive' && !x.is_active);
    return matchQuery && matchShift && matchStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">EMPLOYEES</p>
          <h1>Employees</h1>
          <p className="muted">Manage employee profiles, shifts, and attendance credentials.</p>
        </div>
        <button className="primary" onClick={() => setShow(!show)}>
          <Plus size={17} /> Add Employee
        </button>
      </div>

      {msg && <div className={`alert ${msgType}`}>{msg}</div>}

      {/* Simplified User / Admin Creation Form */}
      {show && (
        <form className="panel form-grid" onSubmit={add}>
          <h2 className="span-2">New Account</h2>

          <label>
            Full name
            <input
              required
              placeholder="e.g. Ahmed Ali"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </label>

          <label>
            Username
            <input
              required
              pattern="[A-Za-z0-9._-]+"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="e.g. ahmed01"
            />
          </label>

          <label>
            Phone Number
            <input
              required
              placeholder="e.g. 071xxxxxxx"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>

          <label>
            Shift
            <select
              value={form.shift}
              onChange={(e) => setForm({ ...form, shift: e.target.value as any })}
              style={{
                border: '1px solid #dce5ee',
                borderRadius: '8px',
                padding: '11px 12px',
                outline: 'none',
                background: 'white',
                color: '#111827',
              }}
            >
              <option value="morning">Morning Shift (Late after 09:00)</option>
              <option value="afternoon">Afternoon Shift (Late after 16:30)</option>
            </select>
          </label>

          <label>
            Temporary password
            <input
              required
              minLength={8}
              placeholder="Minimum 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>

          <p className="muted tiny span-2" style={{ margin: 0 }}>
            Employees sign in with their <strong>username</strong> and the temporary password above.
          </p>

          <div className="span-2" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button className="primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create Employee Account'}
            </button>
            <button type="button" className="secondary" onClick={() => setShow(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Edit Employee Modal */}
      {editEmp && (
        <div className="modal-overlay" onClick={() => setEditEmp(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Edit Profile & Shift</h3>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: '13px' }}>
                  Update account details for <strong>{editEmp.full_name}</strong> (@{editEmp.username})
                </p>
              </div>
              <button className="icon-action-btn" onClick={() => setEditEmp(null)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleEdit} className="modal-form-group">
              <div className="modal-field">
                <span className="modal-field-label">Full Name</span>
                <input
                  required
                  className="modal-input"
                  placeholder="Employee name"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                />
              </div>

              <div className="modal-field">
                <span className="modal-field-label">Phone Number</span>
                <input
                  required
                  className="modal-input"
                  placeholder="e.g. 071xxxxxxx"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                />
              </div>

              <div className="modal-field">
                <span className="modal-field-label">Work Shift</span>
                <select
                  className="modal-select"
                  value={editForm.shift}
                  onChange={(e) => setEditForm({ ...editForm, shift: e.target.value as any })}
                >
                  <option value="morning">â˜€ï¸ Morning Shift (Late after 09:00 AM)</option>
                  <option value="afternoon">ðŸŒ™ Afternoon Shift (Late after 04:30 PM)</option>
                </select>
              </div>

              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setEditEmp(null)}>
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? 'Saving Changes…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetEmp && (
        <div className="modal-overlay" onClick={() => setResetEmp(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reset Password</h3>
              <button className="icon-action-btn" onClick={() => setResetEmp(null)}>
                <X size={16} />
              </button>
            </div>
            <p className="muted" style={{ marginBottom: '14px' }}>
              Set a new password for <strong>{resetEmp.full_name}</strong> (@{resetEmp.username}).
            </p>
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                New Password (minimum 8 characters)
                <input
                  required
                  type="password"
                  minLength={8}
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={() => setResetEmp(null)}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || newPassword.length < 8}>
                  {busy ? 'Updating…' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteEmp && (
        <div className="modal-overlay" onClick={() => setDeleteEmp(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Employee</h3>
              <button className="icon-action-btn" onClick={() => setDeleteEmp(null)}>
                <X size={16} />
              </button>
            </div>
            <p style={{ margin: '10px 0', lineHeight: '1.5' }}>
              Are you sure you want to permanently delete <strong>{deleteEmp.full_name}</strong> (@{deleteEmp.username})?
            </p>
            <p className="muted" style={{ fontSize: '12px', color: '#dc2626' }}>
              This will remove their login account, profile, and attendance history. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setDeleteEmp(null)}>
                Cancel
              </button>
              <button className="primary btn-danger" disabled={busy} onClick={handleDelete}>
                {busy ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee List Section */}
      <section className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <h2>Employees ({filtered.length})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="searchbox">
              <Search size={16} />
              <input
                placeholder="Search name, username, number…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as any)}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '7px 10px',
                fontSize: '12px',
                background: '#ffffff',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              <option value="all">All Shifts</option>
              <option value="morning">Morning Shift</option>
              <option value="afternoon">Afternoon Shift</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '7px 10px',
                fontSize: '12px',
                background: '#ffffff',
                color: '#374151',
                fontWeight: 600,
              }}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone Number</th>
                <th>Username</th>
                <th>Shift</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No employees matching the filter criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const shift = p.shift || 'morning';
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.full_name}</strong>
                      </td>
                      <td>{p.employee_number}</td>
                      <td>{p.username}</td>
                      <td>
                        <span className={`shift-badge ${shift}`}>
                          {shift === 'afternoon' ? 'Afternoon' : 'Morning'}
                        </span>
                      </td>
                      <td>
                        <span className={`status ${p.is_active ? 'present' : 'late'}`}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="actions-cell">
                          {p.role !== 'admin' && (
                            <button
                              className="small-btn"
                              onClick={() => toggle(p)}
                              title={p.is_active ? 'Deactivate Account' : 'Activate Account'}
                            >
                              {p.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                          <button
                            className="icon-action-btn"
                            title="Edit Profile & Shift"
                            onClick={() => {
                              setEditEmp(p);
                              setEditForm({
                                full_name: p.full_name,
                                phone: p.employee_number,
                                shift: p.shift || 'morning',
                              });
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-action-btn"
                            title="Reset Password"
                            onClick={() => {
                              setResetEmp(p);
                              setNewPassword('');
                            }}
                          >
                            <KeyRound size={14} />
                          </button>
                          {p.role !== 'admin' && (
                            <button
                              className="icon-action-btn delete"
                              title="Delete Account"
                              onClick={() => setDeleteEmp(p)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type QrMode = 'auto' | 'manual' | 'fixed';

function QrDisplay() {
  const [mode, setMode] = useState<QrMode>(() => {
    return (localStorage.getItem('qr_mode') as QrMode) || 'auto';
  });
  const [intervalSec, setIntervalSec] = useState<number>(() => {
    const saved = localStorage.getItem('qr_interval');
    return saved ? Math.max(10, parseInt(saved, 10)) : 25;
  });
  const [customInterval, setCustomInterval] = useState(String(intervalSec));

  const [payload, setPayload] = useState('');
  const [expires, setExpires] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(intervalSec);
  const [revoking, setRevoking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const intervalRef = useRef(intervalSec);
  intervalRef.current = intervalSec;

  const handleModeChange = (newMode: QrMode) => {
    setMode(newMode);
    localStorage.setItem('qr_mode', newMode);
  };

  const handleIntervalChange = (val: number) => {
    const clamped = Math.max(10, Math.min(3600, val));
    setIntervalSec(clamped);
    setCustomInterval(String(clamped));
    localStorage.setItem('qr_interval', String(clamped));
    setCountdown(clamped);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      // Calculate token lifetime based on mode:
      // Fixed: 1 year (31,536,000 seconds)
      // Manual: 24 hours (86,400 seconds)
      // Auto: interval + 25 seconds
      const durationSeconds =
        modeRef.current === 'fixed'
          ? 86400
          : modeRef.current === 'manual'
          ? 86400
          : intervalRef.current + 25;

      const data = await generateQrToken(durationSeconds);
      setPayload(data.token);
      setExpires(data.expires_at);
      setErr('');
      if (modeRef.current === 'auto') {
        setCountdown(intervalRef.current);
      }
    } catch (e: any) {
      setErr(e.message || 'Unable to generate QR.');
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch token whenever mode or interval changes
  useEffect(() => {
    refresh();
  }, [mode, intervalSec]);

  // Handle auto-rotation interval
  useEffect(() => {
    if (mode !== 'auto') return;
    const timer = setInterval(() => {
      refresh();
    }, intervalSec * 1000);
    return () => clearInterval(timer);
  }, [mode, intervalSec]);

  // Handle 1-second countdown ticker
  useEffect(() => {
    if (mode !== 'auto') return;
    const ticker = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : intervalSec));
    }, 1000);
    return () => clearInterval(ticker);
  }, [mode, intervalSec]);

  const printQR = () => {
    window.print();
  };

  const revokeAll = async () => {
    const ok = window.confirm(
      'Revoke every active QR code?\n\nAnyone scanning the current code will be refused until you generate a new one.'
    );
    if (!ok) return;
    setRevoking(true);
    try {
      const res = await revokeQrTokens();
      setNotice({ kind: 'success', text: res.message || 'QR codes revoked.' });
      await refresh();
    } catch (e: any) {
      setNotice({ kind: 'error', text: e.message || 'Could not revoke QR codes.' });
    } finally {
      setRevoking(false);
    }
  };

  const expiresLabel = expires
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Mogadishu',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(expires))
    : '';

  return (
    <div className="qr-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">QARDHO OFFICE CHECK-IN</p>
          <h1>Qardho QR Display</h1>
          <p className="muted">Configure rotation behavior and display or print your QR code.</p>
        </div>
        <div className="page-head-actions">
          <button className="secondary" onClick={revokeAll} disabled={revoking || loading}>
            <ShieldCheck size={16} /> {revoking ? 'Revoking…' : 'Revoke QR Codes'}
          </button>
          <button className="secondary" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} /> {loading ? 'Refreshing…' : 'Regenerate QR'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`alert ${notice.kind}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      )}

      {/* Mode Controls */}
      <div className="qr-config-panel">
        <p className="eyebrow" style={{ textAlign: 'center', marginBottom: '8px' }}>
          CHOOSE QR CODE BEHAVIOR
        </p>
        <div className="qr-mode-selector">
          <button
            type="button"
            className={`qr-mode-tab ${mode === 'auto' ? 'active' : ''}`}
            onClick={() => handleModeChange('auto')}
          >
            <RotateCw size={15} /> Auto Every {intervalSec}s
          </button>
          <button
            type="button"
            className={`qr-mode-tab ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => handleModeChange('manual')}
          >
            <Hand size={15} /> Change On Demand
          </button>
          <button
            type="button"
            className={`qr-mode-tab ${mode === 'fixed' ? 'active' : ''}`}
            onClick={() => handleModeChange('fixed')}
          >
            <Pin size={15} /> 24-Hour QR
          </button>
        </div>

        {/* Sub-controls based on active mode */}
        {mode === 'auto' && (
          <div style={{ textAlign: 'center' }}>
            <p className="tiny muted">Select how often the QR code automatically refreshes:</p>
            <div className="interval-row">
              {[15, 25, 30, 60, 120, 300].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`interval-btn ${intervalSec === s ? 'active' : ''}`}
                  onClick={() => handleIntervalChange(s)}
                >
                  {s >= 60 ? `${s / 60}m` : `${s}s`}
                </button>
              ))}
              <div className="interval-custom">
                <span>Custom:</span>
                <input
                  type="number"
                  min="10"
                  max="3600"
                  value={customInterval}
                  onChange={(e) => setCustomInterval(e.target.value)}
                  onBlur={() => {
                    const num = parseInt(customInterval, 10);
                    if (!isNaN(num)) handleIntervalChange(num);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const num = parseInt(customInterval, 10);
                      if (!isNaN(num)) handleIntervalChange(num);
                    }
                  }}
                />
                <span>sec</span>
              </div>
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <p className="tiny muted center">
            This QR code stays valid for 24 hours and <strong>only changes when you click 'Regenerate QR'</strong>.
          </p>
        )}

        {mode === 'fixed' && (
          <div style={{ textAlign: 'center' }}>
            <p className="tiny muted">
              Valid for <strong>24 hours</strong> — print it for the day and reprint the poster
              tomorrow. Older codes stop working automatically.
            </p>
            <div className="qr-action-row">
              <button className="primary" onClick={printQR}>
                <Printer size={16} /> Print QR Poster
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Printable Heading for printouts */}
      <h1 className="print-only-title">Qardho Office Attendance Check-In</h1>
      <p className="print-only-sub">Qardho Branch · Scan this QR code with your phone camera to record Time In.</p>
      <p className="print-only-expiry">
        Valid until <strong>{expiresLabel || '—'}</strong> · Ask the administrator for a fresh poster
        after this time.
      </p>

      {/* Main QR Display Card */}
      <section className="qr-display-card">
        <div
          className="live-label"
          style={{
            background: mode === 'fixed' ? '#fef2f2' : mode === 'manual' ? '#fff4df' : '#fef2f2',
            color: mode === 'fixed' ? '#b91c1c' : mode === 'manual' ? '#b7791f' : '#b91c1c',
          }}
        >
          <span
            className={'live-dot' + (mode === 'auto' ? ' pulsing' : '')}
            style={{
              background: mode === 'fixed' ? '#b91c1c' : mode === 'manual' ? '#b7791f' : '#dc2626',
            }}
          />{' '}
          {mode === 'fixed'
            ? '24-HOUR QR'
            : mode === 'manual'
            ? 'STATIC (CHANGE ON DEMAND)'
            : 'LIVE ROTATING QR'}
        </div>

        {payload ? (
          <>
            <div className="qr-code-box">
              <QRCodeSVG value={payload} size={280} level="H" includeMargin />
            </div>
            <h2>Scan to record Time In</h2>
            <p className="muted">
              {mode === 'fixed'
                ? 'Valid for 24 hours. Employees can scan it until it expires.'
                : mode === 'manual'
                ? 'Only updates when an administrator refreshes it.'
                : `Automatically changes every ${intervalSec} seconds.`}
            </p>

            <div className="expiry">
              {mode === 'fixed' || mode === 'manual' ? (
                <>
                  <Pin size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  Expires <strong>{expiresLabel}</strong>
                </>
              ) : (
                <>
                  Rotates in <strong>{countdown}s</strong>
                </>
              )}
            </div>
          </>
        ) : (
          <p style={{ margin: '30px 0', color: err ? '#c34b4b' : '#6b7280', lineHeight: '1.5' }}>
            {loading ? 'Generating secure QR…' : err}
          </p>
        )}

        <p className="tiny muted">
          Only signed-in employees can use this QR.
        </p>
      </section>
    </div>
  );
}

function Reports() {
  const PAGE = 500;
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'late' | 'absent'>('all');
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [presentKeys, setPresentKeys] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Attendance[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (nextLimit = limit) => {
    if (from > to) {
      setError('The start date is after the end date.');
      return;
    }
    setError('');
    setLoading(true);

    const [attendance, keys] = await Promise.all([
      db
        .from('attendance')
        .select('*, profiles!attendance_employee_id_fkey(full_name,employee_number,department)')
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date')
        .order('time_in')
        .limit(nextLimit + 1),
      // Slim copy of the range, used to work out who was absent.
      db
        .from('attendance')
        .select('employee_id,work_date')
        .gte('work_date', from)
        .lte('work_date', to)
        .limit(5000),
    ]);

    if (attendance.error) {
      setError(attendance.error.message);
      setRows([]);
      setHasMore(false);
    } else {
      const list = (attendance.data || []) as any[];
      setHasMore(list.length > nextLimit);
      setRows(list.slice(0, nextLimit));
      setLimit(nextLimit);
    }

    const keySet = new Set<string>(
      ((keys.data || []) as { employee_id: string; work_date: string }[]).map(
        (k) => `${k.employee_id}|${k.work_date}`
      )
    );
    setPresentKeys(keySet);
    setLoading(false);
  };

  useEffect(() => {
    db.from('profiles')
      .select('id,full_name,employee_number,username,shift,role,is_active')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setEmployees((data || []) as Profile[]));
    load();
  }, []);

  /** Attendance rows matching the shift + status filters. */
  const attendanceRows = rows.filter((r) => {
    const shift = r.shift || r.profiles?.shift || 'morning';
    if (shiftFilter !== 'all' && shift !== shiftFilter) return false;
    if (statusFilter === 'all' || statusFilter === 'absent') return true;
    return r.status === statusFilter;
  });

  /** Working days in the range (Friday is the weekly day off). */
  const workingDays = (() => {
    const days: string[] = [];
    if (!from || !to) return days;
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return days;
    for (let d = start; d <= end && days.length < 366; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 5) continue;
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  })();

  /** Employees with no attendance row for a working day. */
  const absenceRows = (() => {
    if (statusFilter !== 'absent') return [] as { date: string; employee: Profile }[];
    const out: { date: string; employee: Profile }[] = [];
    for (const date of workingDays) {
      for (const employee of employees) {
        const shift = employee.shift || 'morning';
        if (shiftFilter !== 'all' && shift !== shiftFilter) continue;
        if (!presentKeys.has(`${employee.id}|${date}`)) out.push({ date, employee });
      }
    }
    return out;
  })();

  const displayCount = statusFilter === 'absent' ? absenceRows.length : attendanceRows.length;

  const csv = () => {
    const isAbsent = statusFilter === 'absent';
    const lines = isAbsent
      ? [
          ['Date', 'Employee', 'Employee ID', 'Department', 'Shift', 'Status'],
          ...absenceRows.map(({ date, employee }) => {
            const shift = employee.shift || 'morning';
            return [
              date,
              employee.full_name,
              employee.employee_number,
              employee.department || '',
              shift === 'afternoon' ? 'Afternoon' : 'Morning',
              'Absent',
            ];
          }),
        ]
      : [
          ['Date', 'Employee', 'Employee ID', 'Department', 'Shift', 'Time In', 'Status'],
          ...attendanceRows.map((r) => {
            const shift = r.shift || r.profiles?.shift || 'morning';
            return [
              r.work_date,
              r.profiles?.full_name || '',
              r.profiles?.employee_number || '',
              r.profiles?.department || '',
              shift === 'afternoon' ? 'Afternoon' : 'Morning',
              timeLocal(r.time_in),
              r.status,
            ];
          }),
        ];
    const ws = XLSX.utils.aoa_to_sheet(lines);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 28 },
      { wch: 18 },
      { wch: 20 },
      { wch: 14 },
      { wch: 16 },
      { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isAbsent ? 'Absences' : 'Attendance');
    XLSX.writeFile(wb, `attendance_${from}_to_${to}${isAbsent ? '_absences' : ''}.xlsx`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">RECORDS</p>
          <h1>Attendance reports</h1>
          <p className="muted">Filter records and export a formatted Excel workbook.</p>
        </div>
        <button className="primary" onClick={csv} disabled={!displayCount}>
          <Download size={17} /> Export Excel
        </button>
      </div>
      <section className="panel">
        <div className="filters">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Show
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              style={{
                border: '1px solid #dce5ee',
                borderRadius: '8px',
                padding: '11px 12px',
                outline: 'none',
                background: 'white',
                color: '#111827',
              }}
            >
              <option value="all">Present + Late</option>
              <option value="present">Present only</option>
              <option value="late">Late only</option>
              <option value="absent">Absent only</option>
            </select>
          </label>
          <label>
            Shift
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as any)}
              style={{
                border: '1px solid #dce5ee',
                borderRadius: '8px',
                padding: '11px 12px',
                outline: 'none',
                background: 'white',
                color: '#111827',
              }}
            >
              <option value="all">All Shifts</option>
              <option value="morning">Morning Shift</option>
              <option value="afternoon">Afternoon Shift</option>
            </select>
          </label>
          <button className="secondary" onClick={() => load()}>
            <RefreshCw size={16} /> Apply filter
          </button>
        </div>
        {error && (
          <Notice kind="error" onClose={() => setError('')}>
            {error}
          </Notice>
        )}
        <div className="panel-head">
          <h2>
            {displayCount}
            {statusFilter !== 'absent' && hasMore ? '+' : ''}{' '}
            {statusFilter === 'absent'
              ? displayCount === 1
                ? 'absence'
                : 'absences'
              : displayCount === 1
              ? 'attendance record'
              : 'attendance records'}
          </h2>
          <span className="muted">
            {from} — {to}
          </span>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {statusFilter === 'absent' ? (
              <AbsenceTable rows={absenceRows} />
            ) : (
              <AttendanceTable rows={attendanceRows} />
            )}
            {statusFilter !== 'absent' && hasMore && (
              <button
                className="secondary"
                style={{ marginTop: '14px' }}
                onClick={() => load(limit + PAGE)}
              >
                Load {PAGE} more records
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

export default function Admin({ profile }: { profile: Profile }) {
  return (
    <main className="page admin-page">
      <div className="admin-welcome">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <p>
            Signed in as <strong>{profile.full_name}</strong>
          </p>
        </div>
        <span className="admin-tag">Administrator</span>
      </div>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="qr" element={<QrDisplay />} />
        <Route path="reports" element={<Reports />} />
      </Routes>
    </main>
  );
}
