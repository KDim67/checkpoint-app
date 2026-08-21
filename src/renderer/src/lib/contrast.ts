/**
 * Picks a readable foreground for a user-chosen background.
 * YIQ rather than WCAG relative luminance: the threshold was tuned against the
 * board's colour picker presets, and switching formulas flips several of them.
 */
export function getTextColorForBackground(bgColor?: string): string {
  if (!bgColor) return 'var(--color-text-base)'
  const hex = bgColor.replace('#', '')
  if (hex.length !== 6) return '#ffffff'
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 115 ? '#0f172a' : '#ffffff'
}
