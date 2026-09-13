/** named presets, and stored value to CSS */

export const BG_STYLES: Record<string, string> = {
  default: 'var(--color-background)',
  charcoal: '#13141a',
  indigo: '#0a0b12',
  slate: '#1e293b',
  midnight: '#090d16',
  cyberpunk: '#120824',
  nordic: '#1a202c',
  ocean: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  cosmic: 'linear-gradient(135deg, #0f0c20 0%, #2b1055 50%, #7597de 100%)',
  sunset: 'linear-gradient(135deg, #2d0b3f 0%, #7b1fa2 50%, #e91e63 100%)',
  aurora: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  forest: 'linear-gradient(135deg, #062c1e 0%, #114b32 50%, #1b7a52 100%)',
  cyber: 'linear-gradient(135deg, #18002e 0%, #4a0072 50%, #ff007f 100%)',
  gold: 'linear-gradient(135deg, #141414 0%, #2a2415 50%, #4a3e1b 100%)',
  ruby: 'linear-gradient(135deg, #210409 0%, #520b18 50%, #8c162b 100%)'
}

export function getBoardBackgroundStyle(bg: string): string {
  if (!bg) return BG_STYLES.default
  if (Object.hasOwn(BG_STYLES, bg)) {
    const val = BG_STYLES[bg]
    return val.startsWith('url') ? `${val} center / cover no-repeat` : val
  }
  if (bg.startsWith('http://') || bg.startsWith('https://') || bg.startsWith('data:') || bg.startsWith('file://') || bg.startsWith('url(')) {
    return bg.startsWith('url(') ? bg : `url("${bg}") center / cover no-repeat`
  }
  return bg
}
