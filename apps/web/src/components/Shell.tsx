import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import type { NotificationItem } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../lib/datetime';
import EmptyState from './EmptyState';
import ErrorAlert from './ErrorAlert';

const CLINIC = import.meta.env.VITE_CLINIC_NAME || 'Clinic Appointments';
const POLL_MS = 60_000;

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  count?: number;
}

/** Unread count for the bell, polled once a minute. */
export function useUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    api
      .notifications({ unread_only: true, limit: 1 })
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, [enabled]);
  useEffect(() => {
    refresh();
    if (!enabled) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, enabled]);
  return { unread, refresh };
}

export function Shell({
  nav,
  inboxPath,
  accountPath,
  unread = 0,
  children,
}: {
  nav: NavItem[];
  inboxPath?: string;
  accountPath: string;
  unread?: number;
  children: ReactNode;
}) {
  const { me, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🗓
          </span>
          {CLINIC}
        </div>
        <nav className="tabs" aria-label="Main">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="tab nav-link"
              aria-current={undefined}
              style={({ isActive }) => (isActive ? { background: 'var(--color-surface)', fontWeight: 600 } : undefined)}
            >
              {item.label}
              {item.count ? <span className="count">{item.count}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {inboxPath && (
            <Link to={inboxPath} className="btn btn-ghost btn-sm bell" aria-label={`Notifications, ${unread} unread`}>
              🔔{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
            </Link>
          )}
          <Link to={accountPath} className="whoami" title="Account">
            {me?.user.full_name}
          </Link>
          <span className="role-chip">{me?.user.role}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

/** Notification list shared by employees (clinic inbox) and patients. */
export function InboxPage({
  title,
  onChanged,
  openAppointmentPath,
}: {
  title: string;
  onChanged?: () => void;
  openAppointmentPath?: (id: number) => string;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    api
      .notifications({ limit: 100 })
      .then((r) => setItems(r.items))
      .catch(setError);
  }, []);
  useEffect(load, [load]);

  async function open(n: NotificationItem) {
    if (!n.read_at) {
      await api.markRead(n.id).catch(() => {});
      onChanged?.();
      load();
    }
    if (n.appointment_id && openAppointmentPath) navigate(openAppointmentPath(n.appointment_id));
  }

  async function readAll() {
    await api.markAllRead();
    onChanged?.();
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="sub">Newest first</div>
        </div>
        <div className="spacer" />
        <button className="btn btn-secondary btn-sm" onClick={readAll} disabled={!items?.some((i) => !i.read_at)}>
          Mark all as read
        </button>
      </div>
      <ErrorAlert error={error} />
      <div className="card">
        {items === null ? (
          <div className="loading card-pad">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState mark="🔔" title="Nothing here yet" />
        ) : (
          items.map((n) => (
            <div key={n.id} className={`inbox-item${n.read_at ? '' : ' unread'}`}>
              <div className="grow">
                <div className="cell-strong">{n.title}</div>
                {n.detail && <div className="cell-muted">{n.detail}</div>}
                <div className="hint">{formatDateTime(n.created_at)}</div>
              </div>
              {(!n.read_at || (n.appointment_id && openAppointmentPath)) && (
                <button className="btn btn-ghost btn-sm" onClick={() => void open(n)}>
                  {n.appointment_id && openAppointmentPath ? 'Open' : 'Mark read'}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Profile summary + change password, for every role. */
export function AccountPage({ extra }: { extra?: ReactNode }) {
  const { me } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await api.changePassword(me!.user.has_password ? current : undefined, next);
      setDone(true);
      setCurrent('');
      setNext('');
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
          <h1>Account</h1>
          <div className="sub">
            {me.user.email} · {me.user.role}
          </div>
        </div>
      </div>
      {extra}
      <div className="card card-pad" style={{ maxWidth: 480 }}>
        <form className="stack" onSubmit={submit}>
          <h3 style={{ margin: 0 }}>{me.user.has_password ? 'Change password' : 'Set a password'}</h3>
          {!me.user.has_password && <p className="hint">You sign in with Google. Setting a password lets you sign in with email too.</p>}
          <ErrorAlert error={error} />
          {done && <div className="alert alert-info">Password updated.</div>}
          {me.user.has_password && (
            <div className="field">
              <label htmlFor="cur">Current password</label>
              <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="new">New password</label>
            <input id="new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
            <span className="hint">At least 8 characters, with a letter and a number.</span>
          </div>
          <div className="row-end">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
