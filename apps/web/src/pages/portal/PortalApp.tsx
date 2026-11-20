import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { PATIENT_CANCEL_CUTOFF_HOURS, PATIENT_MAX_DAYS_AHEAD } from '@clinic/shared';

import { api } from '../../api/client';
import type { Patient, PortalAppointment, Service, Slot, Staff } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import EmptyState from '../../components/EmptyState';
import ErrorAlert from '../../components/ErrorAlert';
import Modal from '../../components/Modal';
import { AccountPage, InboxPage, Shell, useUnread } from '../../components/Shell';
import StatusBadge from '../../components/StatusBadge';
import { addDays, formatDate, formatDateShort, formatDateTime, formatDayLabel, formatTime, formatTimeRange, nowInput, todayInput } from '../../lib/datetime';

type PublicService = Pick<Service, 'id' | 'name' | 'duration_minutes' | 'description'>;
type PublicStaff = Pick<Staff, 'id' | 'full_name' | 'role'>;

export default function PortalApp() {
  const { unread, refresh } = useUnread(true);
  const nav = [
    // Longest label sits in the middle so the dock stays visually balanced.
    { to: '/portal/book', label: 'Book', icon: 'plus' as const },
    { to: '/portal', label: 'My appointments', end: true, icon: 'calendar' as const },
    { to: '/portal/profile', label: 'Profile', icon: 'user' as const },
  ];
  return (
    <Shell nav={nav} inboxPath="/portal/inbox" accountPath="/portal/account" unread={unread} onRead={refresh}>
      <Routes>
        <Route index element={<MyAppointments />} />
        <Route path="book" element={<BookPage />} />
        <Route path="appointments/:id/reschedule" element={<ReschedulePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="inbox" element={<InboxPage title="Notifications" onChanged={refresh} />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// My appointments
// ---------------------------------------------------------------------------

const ACTIVE = ['pending', 'scheduled', 'confirmed'];

function MyAppointments() {
  const { me } = useAuth();
  const [rows, setRows] = useState<PortalAppointment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState<PortalAppointment | null>(null);

  const load = useCallback(() => {
    api.portal.appointments().then(setRows).catch(setError);
  }, []);
  useEffect(load, [load]);

  const now = nowInput();
  const upcoming = (rows ?? [])
    .filter((a) => ACTIVE.includes(a.status) && a.ends_at.slice(0, 16) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = (rows ?? []).filter((a) => !upcoming.includes(a));
  const needsPhone = me?.patient && !me.patient.phone;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {me?.patient?.first_name ?? me?.user.full_name}</h1>
          <div className="sub">Your appointments at the clinic</div>
        </div>
        <div className="spacer" />
        <Link to="/portal/book" className="btn btn-primary">
          + Book an appointment
        </Link>
      </div>

      {needsPhone && (
        <div className="alert alert-info">
          Please <Link to="/portal/profile">add your mobile number</Link> so the clinic can reach you. It's needed before
          booking.
        </div>
      )}
      <ErrorAlert error={error} />

      <h2 className="section-title">Upcoming</h2>
      {rows === null ? (
        <div className="card loading card-pad">Loading…</div>
      ) : upcoming.length === 0 ? (
        <div className="card">
          <EmptyState mark="🗓" title="No upcoming appointments" action={<Link to="/portal/book" className="btn btn-primary">Book one</Link>} />
        </div>
      ) : (
        <div className="portal-grid">
          {upcoming.map((a) => (
            <AppointmentCard key={a.id} a={a} onCancel={() => setCancelling(a)} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 28 }}>
            Past and cancelled
          </h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Service</th>
                  <th>With</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {past.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {formatDateShort(a.starts_at)} <span className="cell-muted">{formatTime(a.starts_at)}</span>
                    </td>
                    <td>{a.service.name}</td>
                    <td>{a.staff.full_name}</td>
                    <td>
                      <StatusBadge status={a.status} />
                      {a.decision_reason && a.status === 'declined' && <div className="cell-muted">{a.decision_reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cancelling && (
        <CancelDialog
          appt={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AppointmentCard({ a, onCancel }: { a: PortalAppointment; onCancel: () => void }) {
  return (
    <div className="card appt-card">
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <StatusBadge status={a.status} />
        <span className="cell-muted">{a.duration_minutes} min</span>
      </div>
      <h3>{formatDate(a.starts_at)}</h3>
      <div className="cell-strong">{formatTimeRange(a.starts_at, a.ends_at)}</div>
      <div>
        {a.service.name} · {a.staff.full_name}
      </div>
      {a.reason && <div className="cell-muted">“{a.reason}”</div>}
      <div className="hint">
        {a.status === 'pending'
          ? 'Waiting for the clinic to confirm. You will get an email.'
          : a.can_change && a.change_deadline
            ? `You can cancel or reschedule online until ${formatDateTime(a.change_deadline)}.`
            : `Less than ${PATIENT_CANCEL_CUTOFF_HOURS} hours to go — please call the clinic to make changes.`}
      </div>
      {a.can_change && (
        <div className="row-wrap">
          <Link to={`/portal/appointments/${a.id}/reschedule`} className="btn btn-secondary btn-sm">
            Reschedule
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            {a.status === 'pending' ? 'Withdraw request' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}

function CancelDialog({ appt, onClose, onDone }: { appt: PortalAppointment; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.portal.cancel(appt.id, reason.trim() || null);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={appt.status === 'pending' ? 'Withdraw request' : 'Cancel appointment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Cancelling…' : 'Yes, cancel'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <ErrorAlert error={error} />
        <p>
          {appt.service.name} with {appt.staff.full_name} on {formatDate(appt.starts_at)} at {formatTime(appt.starts_at)}.
        </p>
        <div className="field">
          <label htmlFor="cancel-reason">Reason (optional)</label>
          <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Slot picker (shared by booking and rescheduling)
// ---------------------------------------------------------------------------

function SlotPicker({
  serviceId,
  staffId,
  excludeAppointmentId,
  value,
  onChange,
}: {
  serviceId: number;
  staffId: number;
  excludeAppointmentId?: number;
  value: Slot | null;
  onChange: (s: Slot | null) => void;
}) {
  const today = todayInput();
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const maxDate = addDays(today, PATIENT_MAX_DAYS_AHEAD);

  useEffect(() => {
    setSlots(null);
    setError(null);
    onChange(null);
    api.portal
      .availability({ service_id: serviceId, staff_id: staffId, date, exclude_appointment_id: excludeAppointmentId })
      .then((r) => setSlots(r.slots))
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, staffId, date, excludeAppointmentId]);

  return (
    <div className="stack">
      <div className="date-strip" role="group" aria-label="Choose a day">
        {days.map((d) => (
          <button key={d} type="button" className="date-pill" aria-pressed={d === date} onClick={() => setDate(d)}>
            {formatDayLabel(`${d}T00:00`)}
          </button>
        ))}
      </div>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="pick-date">Or pick a date</label>
        <input id="pick-date" type="date" min={today} max={maxDate} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      <ErrorAlert error={error} />
      {slots === null ? (
        <div className="loading">Checking availability…</div>
      ) : slots.length === 0 ? (
        <div className="alert alert-info">No free times on {formatDate(date)}. Try another day.</div>
      ) : (
        <div className="slots" role="group" aria-label="Available times">
          {slots.map((s) => (
            <button
              key={s.starts_at}
              type="button"
              className="slot"
              aria-pressed={value?.starts_at === s.starts_at}
              onClick={() => onChange(s)}
            >
              {formatTime(s.starts_at)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

function BookPage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.portal.services().then(setServices).catch(setError);
  }, []);

  // Only doctors whose specialty covers the chosen service.
  useEffect(() => {
    setStaff([]);
    if (!serviceId) return;
    api.portal.staff(serviceId).then(setStaff).catch(setError);
  }, [serviceId]);

  const service = services.find((s) => s.id === serviceId);
  const member = staff.find((s) => s.id === staffId);
  const step = !serviceId ? 1 : !staffId ? 2 : !slot ? 3 : 4;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!serviceId || !staffId || !slot) return;
    setBusy(true);
    setError(null);
    try {
      await api.portal.book({ service_id: serviceId, staff_id: staffId, starts_at: slot.starts_at, reason: reason.trim() || null });
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (me?.patient && !me.patient.phone) {
    return (
      <div className="page">
        <div className="alert alert-info">
          Please <Link to="/portal/profile">add your mobile number</Link> before booking.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Book an appointment</h1>
          <div className="steps">
            {['Service', 'Doctor', 'Time', 'Confirm'].map((label, i) => (
              <span key={label} className={step === i + 1 ? 'on' : ''}>
                {i + 1}. {label}
                {i < 3 ? ' ›' : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ErrorAlert error={error} />

      <form className="stack" onSubmit={submit}>
        <section className="card card-pad stack">
          <h3 style={{ margin: 0 }}>1. What do you need?</h3>
          <div className="choice-list" role="group" aria-label="Service">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className="choice"
                aria-pressed={s.id === serviceId}
                onClick={() => {
                  setServiceId(s.id);
                  setStaffId(null);
                  setSlot(null);
                }}
              >
                <span className="choice-title">{s.name}</span>
                <span className="choice-sub">
                  {s.duration_minutes} min{s.description ? ` · ${s.description}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>

        {serviceId && (
          <section className="card card-pad stack">
            <h3 style={{ margin: 0 }}>2. Who would you like to see?</h3>
            <p className="hint" style={{ margin: 0 }}>
              Showing doctors who provide {service?.name ?? 'this service'}.
            </p>
            {staff.length === 0 && <div className="alert alert-info">No doctor currently offers this service. Please choose another.</div>}
            <div className="choice-list" role="group" aria-label="Doctor or staff">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="choice"
                  aria-pressed={s.id === staffId}
                  onClick={() => {
                    setStaffId(s.id);
                    setSlot(null);
                  }}
                >
                  <span className="choice-title">{s.full_name}</span>
                  <span className="choice-sub">{s.role}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {serviceId && staffId && (
          <section className="card card-pad stack">
            <h3 style={{ margin: 0 }}>3. Pick a time</h3>
            <SlotPicker serviceId={serviceId} staffId={staffId} value={slot} onChange={setSlot} />
          </section>
        )}

        {slot && service && member && (
          <section className="card card-pad stack">
            <h3 style={{ margin: 0 }}>4. Confirm</h3>
            <p style={{ margin: 0 }}>
              <strong>{service.name}</strong> with <strong>{member.full_name}</strong> on <strong>{formatDate(slot.starts_at)}</strong>{' '}
              at <strong>{formatTime(slot.starts_at)}</strong>.
            </p>
            <div className="field">
              <label htmlFor="reason">Anything the clinic should know? (optional)</label>
              <textarea id="reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <p className="hint">This sends a request. The time is held for you, and you'll get an email once the clinic confirms.</p>
            <div className="row-end">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Sending…' : 'Request appointment'}
              </button>
            </div>
          </section>
        )}
      </form>
    </div>
  );
}

function ReschedulePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appt, setAppt] = useState<PortalAppointment | null>(null);
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [staffId, setStaffId] = useState<number | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.portal
      .appointments()
      .then(async (rows) => {
        const a = rows.find((r) => r.id === Number(id)) ?? null;
        setAppt(a);
        setStaffId(a?.staff.id ?? null);
        if (a) setStaff(await api.portal.staff(a.service.id));
      })
      .catch(setError);
  }, [id]);

  async function submit() {
    if (!appt || !slot || !staffId) return;
    setBusy(true);
    setError(null);
    try {
      await api.portal.reschedule(appt.id, slot.starts_at, staffId !== appt.staff.id ? staffId : undefined);
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (error && !appt) return <div className="page"><ErrorAlert error={error} /></div>;
  if (!appt) return <div className="page loading">Loading…</div>;
  if (!appt.can_change) {
    return (
      <div className="page">
        <div className="alert alert-info">This appointment can no longer be changed online. Please call the clinic.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reschedule</h1>
          <div className="sub">
            {appt.service.name} · currently {formatDate(appt.starts_at)} at {formatTime(appt.starts_at)} with {appt.staff.full_name}
          </div>
        </div>
      </div>
      <ErrorAlert error={error} />
      <div className="card card-pad stack">
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="rs-staff">Doctor or staff</label>
          <select id="rs-staff" value={staffId ?? ''} onChange={(e) => setStaffId(Number(e.target.value))}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} — {s.role}
              </option>
            ))}
          </select>
        </div>
        {staffId && (
          <SlotPicker serviceId={appt.service.id} staffId={staffId} excludeAppointmentId={appt.id} value={slot} onChange={setSlot} />
        )}
        <p className="hint">Your new time goes back to the clinic for confirmation. Your current time is released once you submit.</p>
        <div className="row-end">
          <Link to="/portal" className="btn btn-ghost">
            Back
          </Link>
          <button className="btn btn-primary" disabled={!slot || busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : slot ? `Request ${formatDayLabel(slot.starts_at)} ${formatTime(slot.starts_at)}` : 'Pick a time'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfilePage() {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<Patient | null>(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', date_of_birth: '' });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.portal
      .profile()
      .then((p) => {
        setProfile(p);
        setForm({ first_name: p.first_name, last_name: p.last_name, phone: p.phone, date_of_birth: p.date_of_birth ?? '' });
      })
      .catch(setError);
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api.portal.updateProfile({ ...form, date_of_birth: form.date_of_birth || null });
      setProfile(p);
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <div className="page">{error ? <ErrorAlert error={error} /> : <div className="loading">Loading…</div>}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your profile</h1>
          <div className="sub">{profile.email}</div>
        </div>
      </div>
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={error} />
          {saved && <div className="alert alert-info">Saved.</div>}
          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-fn">First name</label>
              <input id="pf-fn" value={form.first_name} onChange={set('first_name')} required />
            </div>
            <div className="field">
              <label htmlFor="pf-ln">Last name</label>
              <input id="pf-ln" value={form.last_name} onChange={set('last_name')} required />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pf-ph">Mobile number</label>
              <input id="pf-ph" type="tel" value={form.phone} onChange={set('phone')} required minLength={3} />
            </div>
            <div className="field">
              <label htmlFor="pf-dob">Date of birth</label>
              <input id="pf-dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
            </div>
          </div>
          <p className="hint">To change your email address, contact the clinic.</p>
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
