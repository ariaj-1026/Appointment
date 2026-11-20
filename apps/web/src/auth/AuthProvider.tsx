import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { api, ApiError, onUnauthorized } from '../api/client';
import type { Me, Role } from '../api/types';
import { setClinicZone } from '../lib/datetime';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Re-read /me (after login, profile change, …). */
  refresh: () => Promise<Me | null>;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const homeFor = (role: Role) => (role === 'patient' ? '/portal' : role === 'admin' ? '/admin' : '/app');
export const loginFor = (role: Role | null | undefined) => (role === 'patient' || !role ? '/login' : '/staff/login');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const setMe = useCallback((value: Me | null) => {
    if (value) setClinicZone(value.timezone);
    setMeState(value);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const value = await api.me();
      setMe(value);
      return value;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setMe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 mid-session (expired cookie, account deactivated) → back to the
  // right login page with a note.
  useEffect(() => {
    onUnauthorized(() => {
      setMeState((current) => {
        if (current) navigate(`${loginFor(current.user.role)}?expired=1`, { replace: true });
        return null;
      });
    });
    return () => onUnauthorized(null);
  }, [navigate]);

  const logout = useCallback(async () => {
    const role = me?.user.role;
    try {
      await api.logout();
    } finally {
      setMeState(null);
      navigate(loginFor(role), { replace: true });
    }
  }, [me, navigate]);

  const value = useMemo(() => ({ me, loading, refresh, setMe, logout }), [me, loading, refresh, setMe, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Renders children only for the given roles; otherwise redirects sensibly. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page loading">Loading…</div>;
  if (!me) {
    const login = roles.includes('patient') ? '/login' : '/staff/login';
    return <Navigate to={`${login}?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (!roles.includes(me.user.role)) return <Navigate to={homeFor(me.user.role)} replace />;
  return <>{children}</>;
}
