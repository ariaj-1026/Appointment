import { useEffect, useState } from 'react';
import type { HealthResponse } from '@clinic/shared';

/** Proves the web → API → DB chain works after a deploy. */
export function HealthBadge() {
  const [health, setHealth] = useState<HealthResponse | 'error' | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setHealth('error'));
  }, []);

  const text =
    health === null ? 'checking…' : health === 'error' ? 'API unreachable' : `API ok · DB ${health.db}`;
  return <p style={{ marginTop: 32, fontSize: 13, opacity: 0.7 }}>Status: {text}</p>;
}
