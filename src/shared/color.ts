/**
 * Small colour helpers shared by the renderer and the theme model.
 *
 * The YIQ decision lived in `renderer/lib/contrast.ts` and is lifted here rather
 * than copied: the theme model needs the same answer when deriving a readable
 * foreground, and two implementations of "is this background light?" drifting
 * apart is exactly how a button ends up with unreadable text.
 */

/** Parses `#rrggbb` into channels, or null if it is not a six-digit hex. */
export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ]
}

const toHex = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * Perceived brightness, 0–255.
 *
 * YIQ rather than WCAG relative luminance because the threshold below it was
 * tuned against the board's colour picker presets; switching formulas flips
 * several of them.
 */
export function perceivedBrightness(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000
}

/** The brightness at or above which a background wants dark text. */
export const LIGHT_BACKGROUND_THRESHOLD = 115

export const DARK_FOREGROUND = '#0f172a'
export const LIGHT_FOREGROUND = '#ffffff'

/**
 * Picks a readable foreground for a background colour.
 * Returns `fallback` when the input is not a usable hex value.
 */
export function readableForegroundOn(hex: string, fallback = LIGHT_FOREGROUND): string {
  const rgb = parseHex(hex)
  if (!rgb) return fallback
  return perceivedBrightness(...rgb) >= LIGHT_BACKGROUND_THRESHOLD ? DARK_FOREGROUND : LIGHT_FOREGROUND
}

/**
 * Moves a colour toward white by `amount` (0–1), leaving it untouched if the
 * input is not a hex value. Used for hover states, which sit a step brighter
 * than their base in this design system.
 */
export function lighten(hex: string, amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  return '#' + rgb.map(c => toHex(c + (255 - c) * amount)).join('')
}
