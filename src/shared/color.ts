/** YIQ lifted from the renderer so theme and UI agree on light vs dark */

/** null unless six-digit hex */
function parseHex(hex: string): [number, number, number] | null {
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

/** YIQ, not WCAG: the threshold was tuned on the picker presets */
function perceivedBrightness(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000
}

/** at or above wants dark text */
const LIGHT_BACKGROUND_THRESHOLD = 115

const DARK_FOREGROUND = '#0f172a'
export const LIGHT_FOREGROUND = '#ffffff'

/** fallback for unusable input */
export function readableForegroundOn(hex: string, fallback = LIGHT_FOREGROUND): string {
  const rgb = parseHex(hex)
  if (!rgb) return fallback
  return perceivedBrightness(...rgb) >= LIGHT_BACKGROUND_THRESHOLD ? DARK_FOREGROUND : LIGHT_FOREGROUND
}

/** toward white by 0-1, hover states sit a step brighter */
export function lighten(hex: string, amount: number): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  return '#' + rgb.map(c => toHex(c + (255 - c) * amount)).join('')
}

// HSV for the square-and-bar picker

export interface Hsv { h: number; s: number; v: number }

/** null so callers keep their colour */
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
  // normalised first, a negative hue renders "-ff"
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

/** so half-typed hex isn't applied */
export function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

// flattening for things without alpha

/** #rgb, #rrggbb, rgb/rgba in comma or space form; alpha 0-1 */
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

/** composited so a translucent token keeps its look */
export function flattenToHex(value: string, over: string): string | null {
  const fg = parseColor(value)
  const bg = parseColor(over)
  if (!fg || !bg) return null

  const alpha = fg[3]
  return '#' + [0, 1, 2].map(i => toHex(fg[i] * alpha + bg[i] * (1 - alpha))).join('')
}
