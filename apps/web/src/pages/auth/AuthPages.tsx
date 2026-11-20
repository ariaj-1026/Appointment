import React, { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { EMAIL_PATTERN, cleanEmailInput, cleanNameInput } from '@clinic/shared';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../../api/client';
import type { Role } from '../../api/types';
import { homeFor, useAuth } from '../../auth/AuthProvider';
import ErrorAlert from '../../components/ErrorAlert';

// Lazy chunk: the WebGL background loads after the form is interactive.
const DnaBackground = lazy(() => import('../../components/DnaBackground'));

function useIdleReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => setReady(true)) : window.setTimeout(() => setReady(true), 300);
    return () => { if (!w.requestIdleCallback) clearTimeout(id); };
  }, []);
  return ready;
}

type PwProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Password input with an eye button to show/hide the value. */
function PasswordInput(props: PwProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-wrap">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={props.id}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </div>
  );
}

const CLINIC = import.meta.env.VITE_CLINIC_NAME || 'Clinic Appointments';

/** Only same-site paths, never "//evil.com". */
function safeNext(next: string | null, role: Role): string {
  const home = homeFor(role);
  if (!next || !next.startsWith('/') || next.startsWith('//')) return home;
  return next.startsWith(home) ? next : home;
}

function AuthCard({ kicker, title, sub, wide, children }: { kicker: string; title: string; sub?: string; wide?: boolean; children: ReactNode }) {
  const bgReady = useIdleReady();
  return (
    <div className="auth-wrap">
      <div className="auth-bg" aria-hidden="true">
        {bgReady && (
          <Suspense fallback={null}>
            <DnaBackground />
          </Suspense>
        )}
      </div>
      <div className={`auth-card${wide ? ' auth-card-wide' : ''}`}>
        <div className="auth-kicker">
          {CLINIC} · {kicker}
        </div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

function Notice() {
  const [params] = useSearchParams();
  const error = params.get('error');
  if (params.get('expired')) return <div className="alert alert-info">Your session ended. Please sign in again.</div>;
  if (params.get('reset')) return <div className="alert alert-info">Password updated. You can sign in now.</div>;
  if (error) return <div className="alert alert-error">{error}</div>;
  return null;
}

function LoginForm({ portal }: { portal: 'patient' | 'staff' }) {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const me = await api.login(email, password, portal, remember);
      setMe(me);
      navigate(safeNext(params.get('next'), me.user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorAlert error={error} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" pattern={EMAIL_PATTERN} title="Letters, numbers and . _ + - only, e.g. name@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(cleanEmailInput(e.target.value))} required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <label className="remember">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember me</span>
      </label>
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function SignedInRedirect() {
  const { me, loading } = useAuth();
  if (loading || !me) return null;
  return <Navigate to={homeFor(me.user.role)} replace />;
}

export function PatientLogin() {
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    api.googleEnabled().then((r) => setGoogle(r.enabled)).catch(() => setGoogle(false));
  }, []);

  return (
    <AuthCard kicker="Patients" title="Sign in" sub="Book and manage your appointments.">
      <SignedInRedirect />
      <Notice />
      {google && (
        <>
          <a className="btn btn-google btn-block" href="/api/auth/google/start">
            <GoogleMark /> Continue with Google
          </a>
          <div className="divider">or</div>
        </>
      )}
      <LoginForm portal="patient" />
      <div className="auth-links">
        <Link to="/register" className="link-strong"><u>Create Account</u></Link>
        <Link to="/forgot-password">Forgot password?</Link>
      </div>
    </AuthCard>
  );
}

export function StaffLogin() {
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    api.setupStatus().then((r) => setNeedsSetup(r.needed && r.enabled)).catch(() => {});
  }, []);
  return (
    <AuthCard kicker="Staff" title="Staff sign-in" sub="For employees and administrators.">
      <SignedInRedirect />
      <Notice />
      <LoginForm portal="staff" />
      <div className="auth-links">
        <Link to="/forgot-password?staff=1">Forgot password?</Link>
      </div>
      {needsSetup ? (
        <div className="alert alert-info">
          No administrator exists yet. <Link to="/setup">Set up the first admin account</Link>.
        </div>
      ) : (
        <p className="hint">Staff accounts are created by an administrator.</p>
      )}
    </AuthCard>
  );
}

export function Register() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', date_of_birth: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setBusy(true);
    try {
      const me = await api.register({
        email: form.email,
        password: form.password,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        date_of_birth: form.date_of_birth || null,
      });
      setMe(me);
      navigate('/portal/book', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard kicker="Patients" title="Create your account" sub="Request appointments online and get email updates." wide>
      <SignedInRedirect />
      <form className="stack" onSubmit={submit}>
        <ErrorAlert error={error} />
        <div className="reg-grid">
          <fieldset className="reg-section">
            <legend>About you</legend>
            <div className="field-row">
              <div className="field">
            <label htmlFor="fn">First name</label>
            <input id="fn" autoComplete="given-name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: cleanNameInput(e.target.value) }))} maxLength={80} required />
          </div>
              <div className="field">
            <label htmlFor="ln">Last name</label>
            <input id="ln" autoComplete="family-name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: cleanNameInput(e.target.value) }))} maxLength={80} required />
          </div>
            </div>
            <div className="field-row">
              <div className="field">
            <label htmlFor="ph">Mobile number</label>
            <input id="ph" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} required />
          </div>
              <div className="field">
            <label htmlFor="dob">Date of birth <span className="field-optional">(optional)</span></label>
            <input id="dob" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
          </div>
            </div>
          </fieldset>
          <fieldset className="reg-section">
            <legend>Sign-in details</legend>
            <div className="field">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" pattern={EMAIL_PATTERN} title="Letters, numbers and . _ + - only, e.g. name@example.com" autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: cleanEmailInput(e.target.value) }))} required />
        </div>
            <div className="field-row">
              <div className="field">
            <label htmlFor="pw">Password</label>
            <PasswordInput id="pw" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required />
          </div>
              <div className="field">
            <label htmlFor="pw2">Confirm password</label>
            <PasswordInput id="pw2" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
          </div>
            </div>
            <span className={`hint${mismatch ? ' hint-warn' : ''}`}>
          {mismatch ? 'Passwords do not match.' : 'At least 8 characters, with a letter and a number.'}
        </span>
          </fieldset>
        </div>
        <div className="reg-foot">
          <button className="btn btn-primary btn-block" disabled={busy || mismatch}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        </div>
      </form>
      <div className="auth-links">
        <span>
          Already registered? <Link to="/login">Sign in</Link>
        </span>
      </div>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSent((await api.forgotPassword(email)).message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard kicker="Account" title="Reset your password" sub="We'll email you a link to choose a new one.">
      {sent ? (
        <div className="alert alert-info">{sent}</div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={error} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" pattern={EMAIL_PATTERN} title="Letters, numbers and . _ + - only, e.g. name@example.com" value={email} onChange={(e) => setEmail(cleanEmailInput(e.target.value))} required />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <Link to={params.get('staff') ? '/staff/login' : '/login'}>Back to sign-in</Link>
    </AuthCard>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard kicker="Account" title="Choose a new password">
      {!token ? (
        <div className="alert alert-error">This link is incomplete. Request a new one.</div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={error} />
          <div className="field">
            <label htmlFor="pw">New password</label>
            <PasswordInput id="pw" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span className="hint">At least 8 characters, with a letter and a number.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
      )}
      <Link to="/forgot-password">Request a new link</Link>
    </AuthCard>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * One-time first-admin setup for a fresh deployment. Needs SETUP_TOKEN from
 * the Render dashboard; disappears once an admin exists.
 */
export function Setup() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ needed: boolean; enabled: boolean } | null>(null);
  const [form, setForm] = useState({ token: '', full_name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.setupStatus().then(setStatus).catch(setError);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api.setup(form));
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthCard kicker="Setup" title="Create the first admin" sub="Only needed once, on a new deployment.">
      {status && !status.needed ? (
        <div className="alert alert-info">
          Setup is complete. <Link to="/staff/login">Sign in</Link>.
        </div>
      ) : status && !status.enabled ? (
        <div className="alert alert-error">Setup is disabled. Set SETUP_TOKEN on the API server (Render → Environment) and reload.</div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorAlert error={error} />
          <div className="field">
            <label htmlFor="st-token">Setup token</label>
            <input id="st-token" autoComplete="off" value={form.token} onChange={set('token')} required />
            <span className="hint">Render dashboard → clinic-api → Environment → SETUP_TOKEN.</span>
          </div>
          <div className="field">
            <label htmlFor="st-name">Your name</label>
            <input id="st-name" value={form.full_name} onChange={set('full_name')} required />
          </div>
          <div className="field">
            <label htmlFor="st-email">Email</label>
            <input id="st-email" type="email" pattern={EMAIL_PATTERN} autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: cleanEmailInput(e.target.value) }))} required />
          </div>
          <div className="field">
            <label htmlFor="st-pw">Password</label>
            <PasswordInput id="st-pw" autoComplete="new-password" minLength={12} value={form.password} onChange={set('password')} required />
            <span className="hint">At least 12 characters, with a letter and a number.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Creating…' : 'Create admin account'}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
