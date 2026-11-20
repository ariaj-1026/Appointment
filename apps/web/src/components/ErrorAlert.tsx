import { ApiError } from '../api/client';
import { formatTimeRange } from '../lib/datetime';

interface Clash {
  id: number;
  starts_at: string;
  ends_at: string;
  status: string;
  patient_name: string | null;
}

/**
 * Renders an error. A slot conflict carries the clashing appointments, so it
 * lists them — the front desk needs to know what is in the way.
 */
export default function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const clashes: Clash[] | undefined = error instanceof ApiError ? error.detail.conflicting_appointments : undefined;

  return (
    <div className="alert alert-error" role="alert">
      <div>
        <strong>{message}</strong>
        {clashes && clashes.length > 0 && (
          <ul>
            {clashes.map((c) => (
              <li key={c.id}>
                {formatTimeRange(c.starts_at, c.ends_at)}
                {c.patient_name ? ` — ${c.patient_name}` : ''} ({c.status})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
