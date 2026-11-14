import { formatTimeRange } from '../lib/datetime.js'

/**
 * Renders an ApiError. A slot conflict carries the clashing appointments, so
 * it lists them rather than just saying "conflict" — the front desk needs to
 * know what is in the way.
 */
export default function ErrorAlert({ error }) {
  if (!error) return null

  const clashes = error.detail?.conflicting_appointments

  return (
    <div className="alert alert-error" role="alert">
      <div>
        <strong>{error.message}</strong>
        {clashes?.length > 0 && (
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
  )
}
