import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { db } from '../lib/neon';
import {
  generateQrToken,
  createEmployeeAccount,
  adminDeleteEmployee,
  adminResetPassword,
  adminUpdateEmployee,
} from '../lib/api';
import type { Attendance, Profile } from '../lib/types';
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

  const saveThreshold = async () => {
    if (!thresholdInput || !editingThreshold) return;
    setSavingThreshold(true);
    const key = editingThreshold === 'morning' ? 'late_after_morning' : 'late_after_afternoon';
    const { error } = await db
      .from('app_settings')
      .upsert({
        setting_key: key,
        setting_value: thresholdInput,
        updated_at: new Date().toISOString(),
      });
    if (error) {
      alert(error.message);
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

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Query profiles without explicit shift column in the joined select to prevent PostgREST column missing crashes
      const { data: a, error: aErr } = await db
        .from('attendance')
        .select('*, profiles!attendance_employee_id_fkey(full_name,employee_number,department)')
        .eq('work_date', todayLocal())
        .order('time_in');

      if (aErr) {
        console.error('Attendance query error:', aErr);
      } else {
        setRows((a || []) as any);
      }

      const { data: p } = await db
        .from('profiles')
        .select('*')
        .eq('role', 'employee')
        .eq('is_active', true);
      setStaff((p || []) as Profile[]);

      const { data: s } = await db
        .from('app_settings')
        .select('setting_key,setting_value');
      if (s) {
        const morn = s.find((x) => x.setting_key === 'late_after_morning')?.setting_value;
        const legacy = s.find((x) => x.setting_key === 'late_after')?.setting_value;
        const aft = s.find((x) => x.setting_key === 'late_after_afternoon')?.setting_value;
        if (morn) setMorningLateAt(morn);
        else if (legacy) setMorningLateAt(legacy);
        if (aft) setAfternoonLateAt(aft);
      }
    } catch (err) {
      console.error('Error loading attendance dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Neon's Data API has no Realtime channel: poll today's attendance every 10s.
    const interval = setInterval(() => load(true), 10000);
    return () => clearInterval(interval);
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
              color: '#4a2b2f',
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

function Employees() {
  const [list, setList] = useState<Profile[]>([]);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'employee' | 'admin'>('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Simplified form: Name, Username, Phone Number, Shift (default: morning), Password
  const [form, setForm] = useState<{
    full_name: string;
    phone: string;
    username: string;
    email: string;
    role: 'employee' | 'admin';
    password: string;
    shift: 'morning' | 'afternoon';
  }>({
    full_name: '',
    phone: '',
    username: '',
    email: '',
    role: 'employee',
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
    const { data } = await db.from('profiles').select('*').order('full_name');
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
        email: form.email,
        role: form.role,
        password: form.password,
        shift: form.shift,
      });
      setMsgType('success');
      setMsg(data.message || 'Account created successfully.');
      setForm({
        full_name: '',
        phone: '',
        username: '',
        email: '',
        role: 'employee',
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
    const { error } = await db
      .from('profiles')
      .update({ is_active: !p.is_active })
      .eq('id', p.id);
    if (error) alert(error.message);
    else load();
  };

  const filtered = list.filter((x) => {
    const matchQuery = (x.full_name + ' ' + x.employee_number + ' ' + (x.username || ''))
      .toLowerCase()
      .includes(q.toLowerCase());
    const matchRole = roleFilter === 'all' || x.role === roleFilter;
    const matchShift = shiftFilter === 'all' || (x.shift || 'morning') === shiftFilter;
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && x.is_active) ||
      (statusFilter === 'inactive' && !x.is_active);
    return matchQuery && matchRole && matchShift && matchStatus;
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
            Account type
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'employee' | 'admin' })}
              style={{
                border: '1px solid #dce5ee',
                borderRadius: '8px',
                padding: '11px 12px',
                outline: 'none',
                background: 'white',
                color: '#2b1113',
              }}
            >
              <option value="employee">Employee</option>
              <option value="admin">Administrator</option>
            </select>
          </label>

          <label>
            Email {form.role === 'admin' ? '(used to sign in)' : '(optional)'}
            <input
              required={form.role === 'admin'}
              type="email"
              placeholder="e.g. name@gmail.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
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
                color: '#2b1113',
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
            Employees sign in with their <strong>username</strong>. Administrators sign in with the
            full <strong>email</strong> above.
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
          <h2>Accounts ({filtered.length})</h2>
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
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as any)}
              style={{
                border: '1px solid #f2dede',
                borderRadius: '8px',
                padding: '7px 10px',
                fontSize: '12px',
                background: '#fdf5f5',
                color: '#5b3a3e',
                fontWeight: 600,
              }}
            >
              <option value="all">All Roles</option>
              <option value="employee">Employees</option>
              <option value="admin">Administrators</option>
            </select>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value as any)}
              style={{
                border: '1px solid #f2dede',
                borderRadius: '8px',
                padding: '7px 10px',
                fontSize: '12px',
                background: '#fdf5f5',
                color: '#5b3a3e',
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
                border: '1px solid #f2dede',
                borderRadius: '8px',
                padding: '7px 10px',
                fontSize: '12px',
                background: '#fdf5f5',
                color: '#5b3a3e',
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
                <th>Role</th>
                <th>Shift</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
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
                        <span className={`role-badge ${p.role}`}>
                          {p.role === 'admin' ? 'Administrator' : 'Employee'}
                        </span>
                      </td>
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
          ? 31536000
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

  return (
    <div className="qr-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">QARDHO OFFICE CHECK-IN</p>
          <h1>Qardho QR Display</h1>
          <p className="muted">Configure rotation behavior and display or print your QR code.</p>
        </div>
        <button className="secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Refreshing…' : 'Regenerate QR'}
        </button>
      </div>

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
            <Pin size={15} /> Fixed (Permanent)
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
              This QR code is <strong>permanent</strong> (valid for 1 year). Perfect for printing and framing on a wall or reception desk.
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

      {/* Main QR Display Card */}
      <section className="qr-display-card">
        <div
          className="live-label"
          style={{
            background: mode === 'fixed' ? '#fdecec' : mode === 'manual' ? '#fff4df' : '#fdecec',
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
            ? 'PERMANENT FIXED QR'
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
                ? 'Permanent QR code. Employees can scan anytime.'
                : mode === 'manual'
                ? 'Only updates when an administrator refreshes it.'
                : `Automatically changes every ${intervalSec} seconds.`}
            </p>

            <div className="expiry">
              {mode === 'fixed' ? (
                <>
                  <Pin size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  <strong>Fixed permanent QR</strong>
                </>
              ) : mode === 'manual' ? (
                <>
                  <Hand size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  <strong>Changes when you say</strong>
                </>
              ) : (
                <>
                  Rotates in <strong>{countdown}s</strong>
                </>
              )}
            </div>
          </>
        ) : (
          <p style={{ margin: '30px 0', color: err ? '#c34b4b' : '#7a5459', lineHeight: '1.5' }}>
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
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [rows, setRows] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from('attendance')
      .select('*, profiles!attendance_employee_id_fkey(full_name,employee_number,department)')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date')
      .order('time_in');

    if (error) {
      console.error('Reports load error:', error);
    }
    setRows((data || []) as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredRows = shiftFilter === 'all'
    ? rows
    : rows.filter((r) => (r.shift || r.profiles?.shift || 'morning') === shiftFilter);

  const csv = () => {
    const lines = [
      ['Date', 'Employee', 'Employee ID', 'Department', 'Shift', 'Time In', 'Status'],
      ...filteredRows.map((r) => {
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
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, `attendance_${from}_to_${to}.xlsx`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">RECORDS</p>
          <h1>Attendance reports</h1>
          <p className="muted">Filter records and export a formatted Excel workbook.</p>
        </div>
        <button className="primary" onClick={csv} disabled={!filteredRows.length}>
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
                color: '#2b1113',
              }}
            >
              <option value="all">All Shifts</option>
              <option value="morning">Morning Shift</option>
              <option value="afternoon">Afternoon Shift</option>
            </select>
          </label>
          <button className="secondary" onClick={load}>
            <RefreshCw size={16} /> Apply filter
          </button>
        </div>
        <div className="panel-head">
          <h2>{filteredRows.length} attendance records</h2>
          <span className="muted">
            {from} — {to}
          </span>
        </div>
        {loading ? <p className="muted">Loading…</p> : <AttendanceTable rows={filteredRows} />}
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
