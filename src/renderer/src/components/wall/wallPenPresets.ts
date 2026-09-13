/** three saved pens and three highlighters; changing colour or width while one is picked changes that one */

import { STROKE_WIDTHS, WALL_COLORS } from '../../../../shared/wallModel'

export interface PenPreset {
  color: string
  width: number
}

export type PresetTool = 'pen' | 'highlighter'

export interface PenPresets {
  pen: PenPreset[]
  highlighter: PenPreset[]
  active: Record<PresetTool, number>
}

export const PRESET_COUNT = 3

export const DEFAULT_PEN_PRESETS: PenPresets = {
  pen: [
    { color: WALL_COLORS[0], width: STROKE_WIDTHS[1] },
    { color: WALL_COLORS[1], width: STROKE_WIDTHS[0] },
    { color: WALL_COLORS[2], width: STROKE_WIDTHS[2] }
  ],
  highlighter: [
    { color: WALL_COLORS[0], width: STROKE_WIDTHS[2] },
    { color: WALL_COLORS[3], width: STROKE_WIDTHS[2] },
    { color: WALL_COLORS[4], width: STROKE_WIDTHS[2] }
  ],
  active: { pen: 0, highlighter: 0 }
}

const readSlot = (raw: unknown, fallback: PenPreset): PenPreset => {
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as Record<string, unknown>
  return typeof o.color === 'string' && o.color.trim() && typeof o.width === 'number' && STROKE_WIDTHS.includes(o.width)
    ? { color: o.color, width: o.width }
    : fallback
}

const readIndex = (raw: unknown): number => (Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) < PRESET_COUNT ? (raw as number) : 0)

/** slot by slot, one bad preset doesn't cost the other two */
export function normalizePenPresets(raw: unknown): PenPresets {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const slots = (value: unknown, fallback: PenPreset[]): PenPreset[] =>
    fallback.map((slot, i) => readSlot(Array.isArray(value) ? value[i] : undefined, slot))
  const active = o.active && typeof o.active === 'object' ? (o.active as Record<string, unknown>) : {}
  return {
    pen: slots(o.pen, DEFAULT_PEN_PRESETS.pen),
    highlighter: slots(o.highlighter, DEFAULT_PEN_PRESETS.highlighter),
    active: { pen: readIndex(active.pen), highlighter: readIndex(active.highlighter) }
  }
}

export const presetFor = (presets: PenPresets, tool: PresetTool): PenPreset => presets[tool][presets.active[tool]]

export function withPresetChange(presets: PenPresets, tool: PresetTool, patch: Partial<PenPreset>): PenPresets {
  const index = presets.active[tool]
  return { ...presets, [tool]: presets[tool].map((preset, i) => (i === index ? { ...preset, ...patch } : preset)) }
}

export const withActivePreset = (presets: PenPresets, tool: PresetTool, index: number): PenPresets =>
  ({ ...presets, active: { ...presets.active, [tool]: readIndex(index) } })
