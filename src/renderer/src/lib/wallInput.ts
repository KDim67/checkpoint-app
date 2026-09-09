/**
 * Which mouse buttons the wall uses, and for what.
 *
 * Its own module because both ends need it: the wall reads these to decide
 * what a press means, and Settings writes them. Importing them from WallView
 * would pull that whole view, which is lazily loaded and one of the largest
 * chunks in the build, into the settings bundle for the sake of two unions.
 *
 * Both buttons pan out of the box, which is more than either alone can offer.
 * The setting exists because the right button carries two jobs at once, a pan
 * while it is held and a menu if it is let go without moving, and somebody who
 * finds that confusing should be able to hand panning to the middle button and
 * leave the right one to the menu.
 */

export const PAN_BUTTONS_KEY = 'wallview_pan_buttons'
export const MENU_BUTTON_KEY = 'wallview_menu_button'

export const PAN_BUTTON_MODES = ['both', 'middle', 'right'] as const
export const MENU_BUTTON_MODES = ['right', 'middle', 'none'] as const

export type PanButtons = (typeof PAN_BUTTON_MODES)[number]
export type MenuButton = (typeof MENU_BUTTON_MODES)[number]

/** How the pan buttons read once the setting has had its say. */
export function panButtonLabel(mode: PanButtons): string {
  return mode === 'both' ? 'Middle or right-drag' : mode === 'middle' ? 'Middle-drag' : 'Right-drag'
}
