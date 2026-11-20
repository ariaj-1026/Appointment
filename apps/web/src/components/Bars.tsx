/**
 * Horizontal bars for magnitude across staff members.
 *
 * One series, so there is no legend and no categorical palette: every bar is
 * the same ink and identity comes from the row label. Each bar is directly
 * labelled, which is also the relief the contrast check requires, and the
 * table beneath every chart is the accessible view of the same numbers.
 *
 * A null value means capacity was never configured, which is not zero — those
 * rows render as a muted "not set" rather than an empty bar implying 0%.
 */
export interface BarRow {
  key: string | number
  label: string
  sub?: string
  value: number | null | undefined
  display?: string
  valueSub?: string
  over?: boolean
}

export function Bars({ rows }: { rows: BarRow[] }) {
  // Scale to the largest value so short bars stay visible, but never below
  // 100 so a half-full day does not look full.
  const max = Math.max(100, ...rows.map((r) => r.value ?? 0))

  return (
    <div className="bars">
      {rows.map((row) => {
        const known = row.value !== null && row.value !== undefined
        const pct = known ? Math.min((row.value! / max) * 100, 100) : 0
        return (
          <div className="bar-row" key={row.key}>
            <div className="bar-label">
              {row.label}
              {row.sub && <span className="bar-sub">{row.sub}</span>}
            </div>
            <div
              className="bar-track"
              role="img"
              aria-label={`${row.label}: ${known ? row.display : 'capacity not set'}`}
            >
              {known && (
                <div
                  className={`bar-fill${row.over ? ' over' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              )}
            </div>
            <div className="bar-value">
              {known ? row.display : <span className="na">not set</span>}
              {row.valueSub && <span className="bar-value-sub">{row.valueSub}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Compact meter for use inside a table cell. */
export function Meter({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) {
    return <span className="na">not set</span>
  }
  return (
    <div className="meter">
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="meter-value">{pct}%</span>
    </div>
  )
}
