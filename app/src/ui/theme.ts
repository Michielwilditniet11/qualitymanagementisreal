/**
 * The terminal design system. Bloomberg discipline — black ground, hairlines,
 * mono figures, semantic colour used sparingly — crossed with the app's
 * cyan accent. Every surface imports from here; no screen defines its own.
 */
export const T = {
  ground: '#04070E',
  panel: '#080D18',
  panelRaised: '#0B1322',
  hairline: '#16233A',
  hairlineBright: '#22334F',
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, monospace",
  amber: '#FFB020',
  cyan: '#2FD3E6',
  green: '#22C55E',
  red: '#FF4D4D',
  magenta: '#F472B6',
  violet: '#A78BFA',
  text: '#E6EDF6',
  dim: '#B6C2D4',
  muted: '#5B6B84',
  faint: '#3A465C',
}

/** Semantic aliases — meaning, not hue, at the call site. */
export const SEMANTIC = {
  urgent: T.red,
  warn: T.amber,
  ok: T.green,
  info: T.cyan,
  neutral: T.muted,
}

export const SEVERITY_COLORS: Record<string, string> = {
  critical: T.red, warning: T.amber, info: T.cyan,
}

export const POSITION_COLORS: Record<string, string> = {
  strong: T.green, balanced: T.amber, weak: T.red,
}

/** Days-until urgency, shared by the calendar, diagnostics and the web. */
export function urgencyColor(daysLeft: number, missed = false): string {
  if (missed || daysLeft < 0) return T.red
  if (daysLeft <= 30) return T.red
  if (daysLeft <= 90) return T.amber
  if (daysLeft <= 365) return T.cyan
  return T.muted
}

/** Health score 0–100 → colour. */
export function healthColor(score: number): string {
  if (score >= 80) return T.green
  if (score >= 55) return T.amber
  return T.red
}

/** Hex → rgba, for tinted fills and borders derived from one hue. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
}
