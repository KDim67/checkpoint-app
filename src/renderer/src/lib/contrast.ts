import { readableForegroundOn, LIGHT_FOREGROUND } from '../../../shared/color'

/** YIQ lives in shared/color; a missing colour defers to theme text, an unparseable one is assumed dark */
export function getTextColorForBackground(bgColor?: string): string {
  if (!bgColor) return 'var(--color-text-base)'
  return readableForegroundOn(bgColor, LIGHT_FOREGROUND)
}
