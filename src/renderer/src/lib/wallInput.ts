/** own module so Settings doesn't bundle the lazy WallView; panning can move to middle */

export const PAN_BUTTONS_KEY = 'wallview_pan_buttons'
export const MENU_BUTTON_KEY = 'wallview_menu_button'

export const PAN_BUTTON_MODES = ['both', 'middle', 'right'] as const
export const MENU_BUTTON_MODES = ['right', 'middle', 'none'] as const

export type PanButtons = (typeof PAN_BUTTON_MODES)[number]
export type MenuButton = (typeof MENU_BUTTON_MODES)[number]

export function panButtonLabel(mode: PanButtons): string {
  return mode === 'both' ? 'Middle or right-drag' : mode === 'middle' ? 'Middle-drag' : 'Right-drag'
}

/** names one button, avoids "or or or" */
export function panHintLabel(mode: PanButtons): string {
  return mode === 'right' ? 'right-drag' : 'middle-drag'
}
