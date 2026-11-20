import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { api } from '../../api/client';
import type { ActivityEntry, AdminUser, Appointment, Patient, Staff } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import Modal from '../../components/Modal';
import { AccountPage, Shell } from '../../components/Shell';
import StatusBadge from '../../components/StatusBadge';
import { downloadCsv } from '../../lib/csv';
import { formatDateShort, formatDateTime, formatTimeRange, getClinicZone, todayInput, addDays } from '../../lib/datetime';

export default function AdminApp() {
  const nav = [
    { to: '/admin', label: 'Accounts', end: true },
    { to: '/admin/activity', label: 'Activity log' },
    { to: '/admin/records', label: 'Records' },
    { to: '/admin/settings', label: 'Settings' },
  ];
  return (
    <Shell nav={nav} accountPath="/admin/account">
      <Routes>
        <Route index element={<Accounts />} />
        <Route path="activity" element={<Activity />} />
        <Route path="records" element={<Records />} />
        <Route path="settings" element={<ClinicSettings />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function Accounts() {
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    api.admin.users({ role: roleFilter || undefined, q: q || undefined }).then(setUsers).catch(setError);
  }, [roleFilter, q]);
  useEffect(load, [load]);
  useEffect(() => {
    api.listStaff({ include_inactive: true }).then(setStaff).catch(() => {});
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <div className="sub">Employee and admin logins are created here. Patients register themselves.</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New staff account
        </button>
      </div>
      <ErrorAlert error={error} />
      <div className="toolbar">
        <div className="field" style={{ flex: '1 1 240px' }}>
          <label htmlFor="u-q">Search</label>
          <input id="u-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
        </div>
        <div className="field">
          <label htmlFor="u-role">Role</label>
          <select id="u-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All</option>
            <option value="admin">Admin</option>
            <option value="employee">Employee</option>
            <option value="patient">Patient</option>
          </select>
        </div>
      </div>
      <div className="card table-wrap">
        {users === null ? (
          <div className="loading card-pad">Loading…</div>
        ) : users.length === 0 ? (
          <EmptyState mark="👤" title="No accounts match" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Linked staff</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="cell-strong">
                      {u.full_name}
                      {u.id === me?.user.id && <span className="tag">you</span>}
                    </div>
                    <div className="cell-muted">{u.email}</div>
                  </td>
                  <td>
                    <span className="role-chip">{u.role}</span>
                    {u.has_google && <span className="tag">Google</span>}
                  </td>
                  <td>{u.staff?.full_name ?? <span className="cell-muted">—</span>}</td>
                  <td className="cell-muted">{u.last_login_at ? formatDateTime(u.last_login_at) : 'never'}</td>
                  <td>
                    <span className={`badge badge-${u.is_active ? 'confirmed' : 'completed'}`}>{u.is_active ? 'Active' : 'Deactivated'}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>
                        Manage
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <CreateUser
          staff={staff}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <ManageUser
          user={editing}
          staff={staff}
          isSelf={editing.id === me?.user.id}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateUser({ staff, onClose, onCreated }: { staff: Staff[]; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', role: 'employee' as 'employee' | 'admin', password: '', staff_id: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.admin.createUser({
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        password: form.password,
        staff_id: form.staff_id ? Number(form.staff_id) : null,
      });
      onCreated();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New staff account"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-user" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </>
      }
    >
      <form id="create-user" className="modal-body" onSubmit={submit}>
        <ErrorAlert error={error} />
        <div className="field-row">
          <div className="field">
            <label htmlFor="cu-name">Full name</label>
            <input id="cu-name" value={form.full_name} onChange={set('full_name')} required />
          </div>
          <div className="field">
            <label htmlFor="cu-role">Role</label>
            <select id="cu-role" value={form.role} onChange={set('role')}>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cu-email">Email</label>
          <input id="cu-email" type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label htmlFor="cu-pw">Temporary password</label>
          <input id="cu-pw" type="text" autoComplete="off" minLength={8} value={form.password} onChange={set('password')} required />
          <span className="hint">Give this to them in person; they can change it under Account after signing in.</span>
        </div>
        {form.role === 'employee' && (
          <div className="field">
            <label htmlFor="cu-staff">Linked staff member (optional)</label>
            <select id="cu-staff" value={form.staff_id} onChange={set('staff_id')}>
              <option value="">None</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} — {s.role}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </Modal>
  );
}

function ManageUser({
  user,
  staff,
  isSelf,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  staff: Staff[];
  isSelf: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isPatient = user.role === 'patient';
  const [form, setForm] = useState({ full_name: user.full_name, role: user.role, staff_id: user.staff ? String(user.staff.id) : '' });
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      else onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Manage ${user.full_name}`} onClose={onClose}>
      <div className="modal-body">
        <ErrorAlert error={error} />
        {notice && <div className="alert alert-info">{notice}</div>}
        <p className="cell-muted" style={{ margin: 0 }}>
          {user.email} · created {formatDateShort(user.created_at)}
        </p>

        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              api.admin.updateUser(user.id, {
                full_name: form.full_name,
                ...(isPatient ? {} : { role: form.role as 'employee' | 'admin', staff_id: form.staff_id ? Number(form.staff_id) : null }),
              }),
            );
          }}
        >
          <div className="field">
            <label htmlFor="mu-name">Full name</label>
            <input id="mu-name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} required />
          </div>
          {!isPatient && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="mu-role">Role</label>
                <select id="mu-role" value={form.role} disabled={isSelf} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AdminUser['role'] }))}>
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="mu-staff">Linked staff</label>
                <select id="mu-staff" value={form.staff_id} onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}>
                  <option value="">None</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="row-end">
            <button className="btn btn-primary btn-sm" disabled={busy}>
              Save changes
            </button>
          </div>
        </form>

        <hr />
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.admin.setPassword(user.id, password), 'Password updated. Tell the user their new password.').then(() => setPassword(''));
          }}
        >
          <div className="field">
            <label htmlFor="mu-pw">Set a new password</label>
            <input id="mu-pw" type="text" autoComplete="off" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="row-end">
            <button className="btn btn-secondary btn-sm" disabled={busy}>
              Set password
            </button>
          </div>
        </form>

        {!isSelf && (
          <>
            <hr />
            <div className="row-wrap">
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void run(() => api.admin.updateUser(user.id, { is_active: !user.is_active }))}
              >
                {user.is_active ? 'Deactivate account' : 'Reactivate account'}
              </button>
              <span className="hint">Deactivating signs them out immediately and blocks sign-in. Reversible.</span>
            </div>
            <div className="stack-sm">
              <label htmlFor="mu-del" className="hint">
                Delete permanently — type <strong>{user.email}</strong> to confirm.
                {isPatient && ' Their clinical record and appointments are kept as a walk-in patient.'}
              </label>
              <div className="row-wrap">
                <input id="mu-del" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} style={{ flex: 1 }} />
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busy || confirmDelete !== user.email}
                  onClick={() => void run(() => api.admin.deleteUser(user.id))}
                >
                  Delete account
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

const PAGE = 50;
const ACTION_LABELS: Record<string, string> = {
  login: 'Signed in',
  login_google: 'Signed in with Google',
  login_failed: 'Failed sign-in',
  logout: 'Signed out',
  register: 'Registered',
  create: 'Created',
  created: 'Booked',
  update: 'Updated',
  status_changed: 'Status changed',
  rescheduled: 'Rescheduled',
  delete: 'Deleted',
  deactivate: 'Deactivated',
  reactivate: 'Reactivated',
  password_reset_requested: 'Requested password reset',
  password_reset: 'Reset password',
  password_changed: 'Changed password',
  password_set_by_admin: 'Password set by admin',
};

function Activity() {
  const [filters, setFilters] = useState({ q: '', role: '', action: '', entity: '', date_from: addDays(todayInput(), -6), date_to: todayInput() });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: ActivityEntry[] } | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    api.admin
      .activity({ ...filters, limit: PAGE, offset })
      .then(setData)
      .catch(setError);
  }, [filters, offset]);
  useEffect(load, [load]);
  useEffect(() => {
    api.admin.actions().then(setActions).catch(() => {});
  }, []);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  async function exportCsv() {
    const all = await api.admin.activity({ ...filters, limit: 1000, offset: 0 });
    downloadCsv(`activity-${filters.date_from}-to-${filters.date_to}.csv`, [
      { label: 'Time', get: (r: ActivityEntry) => r.created_at },
      { label: 'User', get: (r) => r.user_email ?? '' },
      { label: 'Role', get: (r) => r.actor_role ?? 'anonymous' },
      { label: 'Action', get: (r) => r.action },
      { label: 'Entity', get: (r) => r.entity ?? '' },
      { label: 'Entity id', get: (r) => r.entity_id ?? '' },
      { label: 'Note', get: (r) => r.note ?? '' },
      { label: 'Before', get: (r) => (r.before ? JSON.stringify(r.before) : '') },
      { label: 'After', get: (r) => (r.after ? JSON.stringify(r.after) : '') },
      { label: 'IP', get: (r) => r.ip ?? '' },
    ], all.items);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <div className="sub">Who signed in, from where, and every change made — times in {getClinicZone()}</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-secondary" onClick={() => void exportCsv()} disabled={!data?.total}>
          Export CSV
        </button>
      </div>
      <ErrorAlert error={error} />
      <div className="toolbar">
        <div className="field" style={{ flex: '1 1 200px' }}>
          <label htmlFor="a-q">User or note</label>
          <input id="a-q" value={filters.q} onChange={set('q')} placeholder="email, name, text" />
        </div>
        <div className="field">
          <label htmlFor="a-role">Role</label>
          <select id="a-role" value={filters.role} onChange={set('role')}>
            <option value="">Any</option>
            <option value="admin">Admin</option>
            <option value="employee">Employee</option>
            <option value="patient">Patient</option>
            <option value="anonymous">Not signed in</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-action">Action</label>
          <select id="a-action" value={filters.action} onChange={set('action')}>
            <option value="">Any</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-entity">Record</label>
          <select id="a-entity" value={filters.entity} onChange={set('entity')}>
            <option value="">Any</option>
            {['appointment', 'patient', 'user', 'staff', 'service', 'business_hours', 'settings'].map((e) => (
              <option key={e} value={e}>
                {e.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a-from">From</label>
          <input id="a-from" type="date" value={filters.date_from} max={filters.date_to} onChange={set('date_from')} />
        </div>
        <div className="field">
          <label htmlFor="a-to">To</label>
          <input id="a-to" type="date" value={filters.date_to} min={filters.date_from} onChange={set('date_to')} />
        </div>
      </div>

      <div className="card table-wrap">
        {data === null ? (
          <div className="loading card-pad">Loading…</div>
        ) : data.items.length === 0 ? (
          <EmptyState mark="🕵️" title="No activity for these filters" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Who</th>
                <th>What</th>
                <th>Record</th>
                <th>From</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td className="cell-muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(r.created_at)}
                    </td>
                    <td>
                      <div className="cell-strong">{r.user_name ?? (r.user_id ? `user #${r.user_id} (deleted)` : 'Not signed in')}</div>
                      <div className="cell-muted">{r.user_email ?? ''}</div>
                    </td>
                    <td>
                      <span className={r.action === 'login_failed' || r.action === 'delete' ? 'badge badge-cancelled' : 'badge badge-completed'}>
                        {ACTION_LABELS[r.action] ?? r.action}
                      </span>
                      {r.note && <div className="cell-muted">{r.note}</div>}
                    </td>
                    <td>{r.entity ? `${r.entity.replace('_', ' ')}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—'}</td>
                    <td className="mono cell-muted">{r.ip ?? ''}</td>
                    <td>
                      {(r.before || r.after || r.user_agent) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {open === r.id ? 'Hide' : 'Details'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="field-row">
                          {r.before && (
                            <div className="field">
                              <label>Before</label>
                              <pre className="json mono">{JSON.stringify(r.before, null, 2)}</pre>
                            </div>
                          )}
                          {r.after && (
                            <div className="field">
                              <label>After</label>
                              <pre className="json mono">{JSON.stringify(r.after, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                        {r.user_agent && <div className="hint mono">{r.user_agent}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && data.total > PAGE && (
        <div className="pager">
          <span className="hint">
            {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
            ‹ Newer
          </button>
          <button className="btn btn-secondary btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset((o) => o + PAGE)}>
            Older ›
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records (read-only, with deletion)
// ---------------------------------------------------------------------------

function Records() {
  const [tab, setTab] = useState<'appointments' | 'patients'>('appointments');
  const [q, setQ] = useState('');
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'appointment' | 'patient'; id: number; label: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    if (tab === 'appointments') api.searchAppointments({ q: q || undefined, limit: 200 }).then(setAppts).catch(setError);
    else api.listPatients({ q: q || undefined, limit: 200 }).then(setPatients).catch(setError);
  }, [tab, q]);
  useEffect(load, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Records</h1>
          <div className="sub">Read-only. Deleting is permanent; a full copy is kept in the activity log.</div>
        </div>
        <div className="spacer" />
        <div className="tabs">
          {(['appointments', 'patients'] as const).map((t) => (
            <button key={t} className="tab" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
              {t === 'appointments' ? 'Appointments' : 'Patients'}
            </button>
          ))}
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="toolbar">
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor="r-q">Patient name or phone</label>
          <input id="r-q" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card table-wrap">
        {tab === 'appointments' ? (
          appts === null ? (
            <div className="loading card-pad">Loading…</div>
          ) : appts.length === 0 ? (
            <EmptyState title="No appointments match" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Patient</th>
                  <th>Service / staff</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {appts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {formatDateShort(a.starts_at)} <span className="cell-muted">{formatTimeRange(a.starts_at, a.ends_at)}</span>
                    </td>
                    <td>{a.patient.full_name}</td>
                    <td>
                      {a.service.name}
                      <div className="cell-muted">{a.staff.full_name}</div>
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleting({ kind: 'appointment', id: a.id, label: `${a.patient.full_name}, ${formatDateShort(a.starts_at)} ${formatTimeRange(a.starts_at, a.ends_at)}` })}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : patients === null ? (
          <div className="loading card-pad">Loading…</div>
        ) : patients.length === 0 ? (
          <EmptyState title="No patients match" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Contact</th>
                <th>Account</th>
                <th>Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td className="cell-strong">{p.full_name}</td>
                  <td>
                    {p.phone}
                    <div className="cell-muted">{p.email}</div>
                  </td>
                  <td>{p.user_id ? 'Online account' : <span className="cell-muted">Walk-in</span>}</td>
                  <td className="cell-muted">{formatDateShort(p.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-danger btn-sm" onClick={() => setDeleting({ kind: 'patient', id: p.id, label: p.full_name })}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {deleting && (
        <DeleteDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDone,
}: {
  target: { kind: 'appointment' | 'patient'; id: number; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'patient') await api.admin.deletePatient(target.id, reason);
      else await api.admin.deleteAppointment(target.id, reason);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Delete ${target.kind}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => void confirm()}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <ErrorAlert error={error} />
        <p>
          <strong>{target.label}</strong>
        </p>
        {target.kind === 'patient' && (
          <div className="alert alert-error">This also deletes all of this patient's appointments. Their login (if any) is kept.</div>
        )}
        <div className="field">
          <label htmlFor="del-reason">Reason (recorded in the activity log)</label>
          <textarea id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Clinic settings
// ---------------------------------------------------------------------------

function ClinicSettings() {
  const { refresh } = useAuth();
  const [zone, setZone] = useState(getClinicZone());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const zones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.admin.setTimezone(zone);
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clinic settings</h1>
          <div className="sub">Services, staff and working hours are managed by employees.</div>
        </div>
      </div>
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={error} />
          {saved && <div className="alert alert-info">Time zone saved.</div>}
          <div className="field">
            <label htmlFor="tz">Clinic time zone</label>
            <input id="tz" list="tz-list" value={zone} onChange={(e) => setZone(e.target.value)} required />
            <datalist id="tz-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <span className="hint">
              Default Asia/Manila. Business hours are wall-clock times in this zone; existing appointments keep their exact moment and
              are shown in the new zone.
            </span>
          </div>
          <div className="row-end">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
