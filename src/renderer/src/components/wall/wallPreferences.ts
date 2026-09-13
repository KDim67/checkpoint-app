/** narrow enough not to crowd, wide enough for a real title */
const RAIL_MIN = 190
const RAIL_MAX = 460
// not under wall_, those keys name workspaces
export const RAIL_OPEN_KEY = 'wallview_rail_open'
export const RAIL_WIDTH_KEY = 'wallview_rail_width'
export const SMOOTHING_KEY = 'wallview_pen_smoothing'
export const ARROW_SHAPE_KEY = 'wallview_arrow_shape'
export const ARROW_LINE_KEY = 'wallview_arrow_line'
export const ARROW_HEADS_KEY = 'wallview_arrow_heads'

export const clampRail = (width: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)))
