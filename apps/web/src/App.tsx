import { Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, RequireRole, homeFor, useAuth } from './auth/AuthProvider';
import { ForgotPassword, PatientLogin, Register, ResetPassword, StaffLogin } from './pages/auth/AuthPages';
import AdminApp from './pages/admin/AdminApp';
import EmployeeApp from './pages/employee/EmployeeApp';
import PortalApp from './pages/portal/PortalApp';

/**
 *   /login, /register              patients
 *   /staff/login                   employees and admins (one page)
 *   /portal/*                      patient portal
 *   /app/*                         employee app (the v1 screens + requests/inbox)
 *   /admin/*                       admin console
 */
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<PatientLogin />} />
        <Route path="/register" element={<Register />} />
        <Route path="/staff/login" element={<StaffLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/portal/*" element={<RequireRole roles={['patient']}><PortalApp /></RequireRole>} />
        <Route path="/app/*" element={<RequireRole roles={['employee']}><EmployeeApp /></RequireRole>} />
        <Route path="/admin/*" element={<RequireRole roles={['admin']}><AdminApp /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <div className="page loading">Loading…</div>;
  return <Navigate to={me ? homeFor(me.user.role) : '/login'} replace />;
}
