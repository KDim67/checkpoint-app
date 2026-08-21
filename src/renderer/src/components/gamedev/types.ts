export interface AssetFile {
  name: string
  path: string
  status: 'pending' | 'success' | 'error'
  error?: string
}

export interface DialogueNode {
  id: string
  speaker: string
  text: string
  choices: Array<{ text: string; nextId: string }>
}

export type GameDevTab =
  | 'renamer'
  | 'dialogue'
  | 'palette'
  | 'pbr'
  | 'seamless'
  | 'atlas'
  | 'slicer'
  | 'lut'
  | 'upscaler'
  | 'mapmaker'

export const PALETTE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

/** Hex to RGB in the 0–1 float range the shader/engine snippets expect. */
export function hexToRgbFloat(hex: string) {
  let c = hex.substring(1)
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  }
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  return { r: parseFloat(r.toFixed(3)), g: parseFloat(g.toFixed(3)), b: parseFloat(b.toFixed(3)) }
}
