/**
 * WCAG 2.1 contrast audit of the design tokens.
 *
 * Every text/background pair the UI actually renders, checked against the
 * threshold that applies to it:
 *   - body text        4.5:1
 *   - large/bold text  3.0:1  (>=18.66px bold or >=24px)
 *   - UI boundaries    3.0:1  (focus rings, borders that carry meaning)
 */

const T = {
  bg: '#ffffff',
  surface: '#fffdf5',
  primary: '#f5c518',
  primaryDark: '#d4a70c',
  primaryDarker: '#a37f06',
  accent: '#fff3c4',
  accentStrong: '#ffe68a',
  border: '#e8e3d3',
  borderStrong: '#cfc8b2',
  text: '#1a1a1a',
  textMuted: '#6b6b6b',
  markPrimary: '#a37f06',
  markTrack: '#f5edcf',
  // status badge fg/bg
  schedFg: '#8a6d03', schedBg: '#fff8dd',
  confFg: '#2e7d32', confBg: '#e8f5e9',
  compFg: '#5f6368', compBg: '#eceff1',
  cancFg: '#c62828', cancBg: '#fdecea',
  nshFg: '#c24300', nshBg: '#fff3e0',
  dangerFg: '#8e1f1a', dangerBg: '#fdecea',
  infoFg: '#6b5503', infoBg: '#fff3c4',
}

const srgb = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
}
const lum = (h) => {
  const [r, g, b] = srgb(h)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const checks = [
  ['body text on page', T.text, T.bg, 4.5],
  ['body text on surface', T.text, T.surface, 4.5],
  ['muted text on page', T.textMuted, T.bg, 4.5],
  ['muted text on surface', T.textMuted, T.surface, 4.5],
  ['text on primary button', T.text, T.primary, 4.5],
  ['text on primary hover', T.text, T.primaryDark, 4.5],
  ['text on accent (active tab)', T.text, T.accent, 4.5],
  ['text on accent-strong', T.text, T.accentStrong, 4.5],
  ['text on mark track', T.text, T.markTrack, 4.5],

  ['badge scheduled', T.schedFg, T.schedBg, 4.5],
  ['badge confirmed', T.confFg, T.confBg, 4.5],
  ['badge completed', T.compFg, T.compBg, 4.5],
  ['badge cancelled', T.cancFg, T.cancBg, 4.5],
  ['badge no-show', T.nshFg, T.nshBg, 4.5],

  ['error alert text', T.dangerFg, T.dangerBg, 4.5],
  ['info alert text', T.infoFg, T.infoBg, 4.5],

  ['appt text on scheduled tile', T.text, T.schedBg, 4.5],
  ['appt text on confirmed tile', T.text, T.confBg, 4.5],
  ['appt text on completed tile', T.text, T.compBg, 4.5],
  ['appt text on cancelled tile', T.text, T.cancBg, 4.5],
  ['appt text on no-show tile', T.text, T.nshBg, 4.5],
  ['muted appt meta on scheduled', T.textMuted, T.schedBg, 4.5],
  ['muted appt meta on confirmed', T.textMuted, T.confBg, 4.5],
  ['muted appt meta on completed', T.textMuted, T.compBg, 4.5],

  ['focus ring vs page (UI 3:1)', T.primaryDarker, T.bg, 3.0],
  ['focus ring vs surface (UI 3:1)', T.primaryDarker, T.surface, 3.0],
  ['secondary btn border vs page (UI 3:1)', '#978e70', T.bg, 3.0],
  ['input border vs surface (UI 3:1)', '#978e70', T.surface, 3.0],
  ['bar mark vs track (UI 3:1)', T.markPrimary, T.markTrack, 3.0],
  ['bar mark vs page (UI 3:1)', T.markPrimary, T.bg, 3.0],
  ['input border vs page (UI 3:1)', '#978e70', T.bg, 3.0],
]

let fails = 0
console.log('pair'.padEnd(38), 'ratio'.padStart(7), ' need  result')
console.log('-'.repeat(68))
for (const [name, fg, bg, need] of checks) {
  const r = ratio(fg, bg)
  const ok = r >= need
  if (!ok) fails++
  console.log(
    name.padEnd(38),
    r.toFixed(2).padStart(7),
    ` ${need.toFixed(1)}  ${ok ? 'PASS' : '*** FAIL ***'}`,
  )
}
console.log('-'.repeat(68))
console.log(fails === 0 ? 'All pairs pass.' : `${fails} FAILING pair(s).`)
