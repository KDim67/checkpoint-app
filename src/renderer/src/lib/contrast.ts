import { readableForegroundOn, LIGHT_FOREGROUND } from '../../../shared/color'

/**
 * Picks a readable foreground for a user-chosen background.
 *
 * The YIQ formula and its threshold now live in `shared/color.ts` so the theme
 * model derives the same answer; this wrapper keeps the renderer-specific
 * fallbacks it always had, a missing colour defers to the theme's own text
 * colour, while an unparseable one is assumed dark.
 */
export function getTextColorForBackground(bgColor?: string): string {
  if (!bgColor) return 'var(--color-text-base)'
  return readableForegroundOn(bgColor, LIGHT_FOREGROUND)
}
