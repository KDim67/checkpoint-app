import type { BrowserWindow } from 'electron'

/** the window's own minimise, maximise and close buttons, in the colours the page reports its title bar drawn in */
export interface TitleBarColors {
  /** behind the buttons */
  color: string
  /** the buttons' marks */
  symbolColor: string
}

/** the dark theme's, for a first launch before the page has said */
export const DEFAULT_TITLE_BAR: TitleBarColors = { color: '#0b0c10', symbolColor: '#f1f5f9' }

/** kept so the next launch opens in the colours the last one closed in, with no flash of the default */
export const TITLE_BAR_SETTING = 'window_title_bar_colors'

const HEX = /^#[0-9a-f]{6}$/i

/** two plain hex colours or nothing; whatever else the page sends is ignored */
export function readTitleBarColors(raw: unknown): TitleBarColors | null {
  if (!raw || typeof raw !== 'object') return null
  const { color, symbolColor } = raw as Record<string, unknown>
  if (typeof color !== 'string' || !HEX.test(color) || typeof symbolColor !== 'string' || !HEX.test(symbolColor)) return null
  return { color: color.toLowerCase(), symbolColor: symbolColor.toLowerCase() }
}

/** the buttons, and the window behind the page so a resize never flashes another colour */
export function paintTitleBar(win: BrowserWindow, colors: TitleBarColors): void {
  if (win.isDestroyed()) return
  try {
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor })
  } catch {
    // a window without the buttons, as on a mac, has nothing to paint
  }
  win.setBackgroundColor(colors.color)
}
