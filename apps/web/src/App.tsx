import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { HealthBadge } from './HealthBadge';

// Placeholder pages; real screens land in Phases 2–6 (ROADMAP_V2.md).
function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1>{title}</h1>
      <p>{note}</p>
      <nav style={{ display: 'flex', gap: 12 }}>
        <Link to="/login">Patient login</Link>
        <Link to="/staff/login">Staff login</Link>
      </nav>
      <HealthBadge />
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Placeholder title="Patient login" note="Email/password + Google — Phase 2." />} />
      <Route path="/staff/login" element={<Placeholder title="Staff login" note="Employees and admins — Phase 2." />} />
      <Route path="*" element={<Placeholder title="Not found" note="No such page." />} />
    </Routes>
  );
}
