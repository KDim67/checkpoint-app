/** the tools the toolbar arms; the pen family shares one panel and one gesture */
export type WallTool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'arrow'

export const DRAW_TOOLS = ['pen', 'highlighter', 'eraser', 'lasso'] as const
export type DrawTool = (typeof DRAW_TOOLS)[number]

export const isDrawTool = (tool: WallTool): tool is DrawTool => (DRAW_TOOLS as readonly WallTool[]).includes(tool)

/** whole strokes go at a touch, or only the part the eraser passes over */
export type EraserMode = 'stroke' | 'part'
export const ERASER_MODES: readonly EraserMode[] = ['stroke', 'part']

/** screen pixels either side of the pointer, so the eraser reaches as far at any zoom */
export const ERASER_RADIUS = 10
