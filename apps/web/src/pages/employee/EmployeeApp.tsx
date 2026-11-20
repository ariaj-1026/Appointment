import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { api } from '../../api/client';
import type { Appointment, Service, Staff } from '../../api/types';
import AppointmentDetail from '../../components/AppointmentDetail';
import type { HoursByStaff } from '../../components/DayCalendar';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import { AccountPage, InboxPage, Shell, useUnread } from '../../components/Shell';
import StatusBadge from '../../components/StatusBadge';
import { formatDateShort, formatTimeRange } from '../../lib/datetime';
import Reports from './Reports';
import Schedule from './Schedule';
import Search from './Search';
import Settings from './Settings';

export interface RefData {
  staff: Staff[];
  services: Service[];
  hoursByStaff: HoursByStaff;
}

/** Staff, services and hours: small, rarely changing, needed everywhere. */
export function useRefData() {
  const [data, setData] = useState<RefData>({ staff: [], services: [], hoursByStaff: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [staff, services] = await Promise.all([
        api.listStaff({ include_inactive: true }),
        api.listServices({ include_inactive: true }),
      ]);
      const hours = await Promise.all(staff.map((s) => api.getBusinessHours(s.id).catch(() => [])));
      setData({ staff, services, hoursByStaff: Object.fromEntries(staff.map((s, i) => [s.id, hours[i]!])) });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  return { ...data, loading, error, reload: load };
}

export default function EmployeeApp() {
  const refs = useRefData();
  const { unread, refresh: refreshUnread } = useUnread(true);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(() => {
    api
      .searchAppointments({ status: 'pending', limit: 100 })
      .then((rows) => setPendingCount(rows.length))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshPending();
    const t = setInterval(refreshPending, 60_000);
    return () => clearInterval(t);
  }, [refreshPending]);

  // Inactive rows are kept for history views; only booking narrows to active.
  const activeServices = refs.services.filter((s) => s.is_active);

  const nav = [
    { to: '/app', label: 'Schedule', end: true, icon: 'calendar' as const },
    { to: '/app/requests', label: 'Requests', count: pendingCount, icon: 'inbox' as const },
    { to: '/app/find', label: 'Find', icon: 'search' as const },
    { to: '/app/reports', label: 'Reports', icon: 'chart' as const },
    { to: '/app/settings', label: 'Settings', icon: 'settings' as const },
  ];

  return (
    <Shell nav={nav} inboxPath="/app/inbox" accountPath="/app/account" unread={unread} onRead={refreshUnread}>
      {refs.loading ? (
        <div className="page loading">Loading…</div>
      ) : refs.error ? (
        <div className="page">
          <ErrorAlert error={refs.error} />
          <button className="btn btn-primary" onClick={() => void refs.reload()} style={{ marginTop: 16 }}>
            Try again
          </button>
        </div>
      ) : (
        <Routes>
          <Route
            index
            element={<Schedule staff={refs.staff} services={activeServices} hoursByStaff={refs.hoursByStaff} reloadRefs={() => void refs.reload()} />}
          />
          <Route path="requests" element={<Requests staff={refs.staff} services={refs.services} onChanged={refreshPending} />} />
          <Route path="find" element={<Search staff={refs.staff} services={refs.services} />} />
          <Route path="reports" element={<Reports staff={refs.staff} />} />
          <Route path="settings" element={<Settings staff={refs.staff} services={refs.services} reload={refs.reload} />} />
          <Route
            path="inbox"
            element={<InboxPage title="Clinic inbox" onChanged={refreshUnread} openAppointmentPath={(id) => `/app/appointments/${id}`} />}
          />
          <Route
            path="appointments/:id"
            element={<AppointmentRoute staff={refs.staff} services={refs.services} onChanged={refreshPending} />}
          />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      )}
    </Shell>
  );
}

/** Pending patient requests, oldest first, with one-click approve. */
function Requests({ staff, services, onChanged }: { staff: Staff[]; services: Service[]; onChanged: () => void }) {
  const [rows, setRows] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .searchAppointments({ status: 'pending', limit: 200 })
      .then((r) => setRows([...r].sort((a, b) => a.starts_at.localeCompare(b.starts_at))))
      .catch(setError);
  }, []);
  useEffect(load, [load]);

  async function approve(a: Appointment) {
    setError(null);
    setBusyId(a.id);
    try {
      await api.approve(a.id);
      load();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Booking requests</h1>
          <div className="sub">Requested online by patients. Each one holds its slot until you decide.</div>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="card table-wrap">
        {rows === null ? (
          <div className="loading card-pad">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState mark="✅" title="No pending requests">
            New requests from the patient portal appear here.
          </EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Patient</th>
                <th>Service / staff</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cell-strong">{formatDateShort(a.starts_at)}</div>
                    <div className="cell-muted">{formatTimeRange(a.starts_at, a.ends_at)}</div>
                  </td>
                  <td>
                    <div className="cell-strong">{a.patient.full_name}</div>
                    <div className="cell-muted">{a.patient.phone || a.patient.email}</div>
                  </td>
                  <td>
                    {a.service.name}
                    <div className="cell-muted">{a.staff.full_name}</div>
                  </td>
                  <td className="cell-muted">{a.reason || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-primary btn-sm" disabled={busyId === a.id} onClick={() => void approve(a)}>
                        Approve
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setSelected(a)}>
                        Open / decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selected && (
        <AppointmentDetail
          appointment={selected}
          staff={staff}
          services={services}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            setSelected(updated.status === 'pending' ? updated : null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Deep link to one appointment (from the inbox). */
function AppointmentRoute({ staff, services, onChanged }: { staff: Staff[]; services: Service[]; onChanged: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.getAppointment(Number(id)).then(setAppt).catch(setError);
  }, [id]);

  return (
    <div className="page">
      <ErrorAlert error={error} />
      {appt && (
        <>
          <div className="card card-pad">
            <StatusBadge status={appt.status} /> {appt.patient.full_name} · {formatDateShort(appt.starts_at)}{' '}
            {formatTimeRange(appt.starts_at, appt.ends_at)}
          </div>
          <AppointmentDetail
            appointment={appt}
            staff={staff}
            services={services}
            onClose={() => navigate(-1)}
            onChanged={(u) => {
              setAppt(u);
              onChanged();
            }}
          />
        </>
      )}
    </div>
  );
}
