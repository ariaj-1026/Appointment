import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  icon?: IconName;
}

const ICONS = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  inbox: 'M4 13l2.5-7h11L20 13M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16.5 16.5L21 21',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** macOS-style floating dock: icon with its label underneath. */
function Dock({ items }: { items: NavItem[] }) {
  return (
    <nav className="dock" aria-label="Main">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="dock-item nav-link" aria-label={item.label} title={item.label}>
          <span className="dock-icon">
            <Icon name={item.icon ?? 'folder'} />
            {item.count ? <span className="dock-badge">{item.count > 99 ? '99+' : item.count}</span> : null}
          </span>
          <span className="dock-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
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
  onRead,
  children,
}: {
  nav: NavItem[];
  inboxPath?: string;
  accountPath: string;
  unread?: number;
  /** Called after notifications are marked read, to refresh the count. */
  onRead?: () => void;
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
        <div className="topbar-right">
          {inboxPath && <Bell inboxPath={inboxPath} unread={unread} onRead={onRead} />}
          <Link to={accountPath} className="whoami" title="Account">
            {me?.user.full_name}
          </Link>
          <span className="role-chip">{me?.user.role}</span>
          <button className="btn btn-signout btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <Dock items={nav} />
    </div>
  );
}

/** Bell with a dropdown of the latest notifications. */
function Bell({ inboxPath, unread, onRead }: { inboxPath: string; unread: number; onRead?: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setItems(null);
    api.notifications({ limit: 8 }).then((r) => setItems(r.items)).catch(() => setItems([]));
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function readAll() {
    await api.markAllRead().catch(() => {});
    setItems((xs) => xs?.map((x) => ({ ...x, read_at: x.read_at ?? 'now' })) ?? null);
    onRead?.();
  }

  return (
    <div className="bell-wrap" ref={ref}>
      <button
        className="btn btn-ghost btn-sm bell"
        aria-label={`Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => void readAll()} disabled={unread === 0}>
              Mark all read
            </button>
          </div>
          {items === null ? (
            <div className="hint card-pad">Loading…</div>
          ) : items.length === 0 ? (
            <div className="hint card-pad">No notifications yet.</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`inbox-item${n.read_at ? '' : ' unread'}`}>
                <div className="grow">
                  <div className="cell-strong">{n.title}</div>
                  {n.detail && <div className="cell-muted">{n.detail}</div>}
                  <div className="hint">{formatDateTime(n.created_at)}</div>
                </div>
              </div>
            ))
          )}
          <div className="bell-foot">
            <button
              className="btn btn-secondary btn-sm btn-block"
              onClick={() => {
                setOpen(false);
                navigate(inboxPath);
              }}
            >
              View all
            </button>
          </div>
        </div>
      )}
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
