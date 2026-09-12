/** What the wall remembers between sessions, and how wide the board panel may get. */

/** Narrow enough not to crowd the wall, wide enough for a real card title. */
const RAIL_MIN = 190
const RAIL_MAX = 460
// Deliberately not under the `wall_` prefix: those keys name a workspace,
// and a workspace called "rail_open" would own this one. These are preferences.
export const RAIL_OPEN_KEY = 'wallview_rail_open'
export const RAIL_WIDTH_KEY = 'wallview_rail_width'
export const SMOOTHING_KEY = 'wallview_pen_smoothing'
export const ARROW_SHAPE_KEY = 'wallview_arrow_shape'
export const ARROW_LINE_KEY = 'wallview_arrow_line'
export const ARROW_HEADS_KEY = 'wallview_arrow_heads'

export const clampRail = (width: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)))
