/** in lib/ since Fast Refresh needs a module to export components or values, not both */

export type FontSize = 'small' | 'medium' | 'large'

const FONT_SCALES: Record<FontSize, string> = {
  small: '0.9',
  medium: '1.0',
  large: '1.125'
}

/** rem, scaled together to keep the ramp's proportions */
const BASE_TOKENS: Record<string, number> = {
  '--text-2xs': 0.625,
  '--text-xs': 0.75,
  '--text-sm': 0.875,
  '--text-base': 1.0,
  '--text-lg': 1.125,
  '--text-xl': 1.25,
  '--text-2xl': 1.5
}

export function applyFontSize(size: FontSize): void {
  const root = document.documentElement
  root.style.setProperty('--font-size-scale', FONT_SCALES[size])
  const scale = parseFloat(FONT_SCALES[size])
  for (const [token, base] of Object.entries(BASE_TOKENS)) {
    root.style.setProperty(token, `${base * scale}rem`)
  }
}
