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

// HSV, for a picker with a saturation square and a hue bar

export interface Hsv { h: number; s: number; v: number }

/** Null for anything unparseable, so a caller can keep its previous colour. */
export function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHex(hex)
  if (!rgb) return null

  const [r, g, b] = rgb.map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  // Normalised first, not just for the sector: a negative hue otherwise drives
  // `x` negative and the channel renders as "-ff".
  const hue = ((h % 360) + 360) % 360

  const c = v * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = v - c

  const sector = Math.floor(hue / 60)
  const [r, g, b] = (
    sector === 0 ? [c, x, 0] :
    sector === 1 ? [x, c, 0] :
    sector === 2 ? [0, c, x] :
    sector === 3 ? [0, x, c] :
    sector === 4 ? [x, 0, c] :
    [c, 0, x]
  )

  const channel = (n: number): string =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0')

  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** True for the `#rrggbb` the pickers emit, so a half-typed hex is not applied. */
export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

// Flattening, for the places that cannot take an alpha channel

/**
 * Parses the formats a theme token actually carries: `#rgb`, `#rrggbb`,
 * `rgb(...)` and `rgba(...)`, in the legacy comma form or the space form.
 * Alpha comes back as 0–1. Null for anything else, so a caller can fall back
 * rather than pass a value on to something that cannot read it.
 */
export function parseColor(value: string): [number, number, number, number] | null {
  const v = value.trim()

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  if (short) {
    const [r, g, b] = short.slice(1, 4).map(c => parseInt(c + c, 16))
    return [r, g, b, 1]
  }

  const rgb = parseHex(v)
  if (rgb) return [rgb[0], rgb[1], rgb[2], 1]

  const fn = /^rgba?\(([^)]*)\)$/i.exec(v)
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null

  const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1
  return [parts[0], parts[1], parts[2], Math.max(0, Math.min(1, alpha))]
}

/**
 * Composites a colour onto an opaque backdrop and returns `#rrggbb`, so a
 * translucent token survives as the colour it looked like rather than as the
 * full-strength one underneath it. Null when either input is unparseable.
 */
export function flattenToHex(value: string, over: string): string | null {
  const fg = parseColor(value)
  const bg = parseColor(over)
  if (!fg || !bg) return null

  const alpha = fg[3]
  return '#' + [0, 1, 2].map(i => toHex(fg[i] * alpha + bg[i] * (1 - alpha))).join('')
}
