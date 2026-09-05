export interface AssetFile {
  name: string
  path: string
  status: 'pending' | 'success' | 'error'
  error?: string
}


/** The naming conventions the batch renamer offers. Closed sets, so a select
 * element's string value is checked against them rather than trusted. */
export type RenamerPreset = 'none' | 'texture' | 'mesh' | 'audio'
/** The sizes an atlas may be packed into, and the ways a sprite may be scaled. */
export type AtlasMaxSize = 1024 | 2048 | 4096
export type UpscaleAlgorithm =
  | 'nearest2x' | 'nearest4x' | 'nearest8x'
  | 'scale2x' | 'scale3x' | 'scale4x'
export type RenamerSuffixPreset = 'none' | 'diffuse' | 'normal'

export interface DialogueNode {
  id: string
  speaker: string
  text: string
  choices: Array<{ text: string; nextId: string }>
}

/**
 * Reads a dialogue tree the AI produced.
 *
 * The model is asked for a particular shape and returns its best attempt, so
 * every field is treated as absent until proved otherwise. A node with no id
 * gets one, since the editor keys off it and two blanks would collide.
 *
 * `target` as well as `nextId`: the two prompts in the app have asked for both
 * names over time, and replies still come back either way.
 */
export function normalizeDialogueNodes(raw: unknown, makeId: () => string): DialogueNode[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object' && !Array.isArray(n))
    .map(n => {
      const choices = Array.isArray(n.choices) ? n.choices : []
      return {
        id: typeof n.id === 'string' && n.id.trim() ? n.id.trim() : makeId(),
        speaker: typeof n.speaker === 'string' && n.speaker.trim() ? n.speaker : 'NPC',
        text: typeof n.text === 'string' ? n.text : '',
        choices: choices
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
          .map(c => ({
            text: typeof c.text === 'string' ? c.text : '',
            nextId: typeof c.target === 'string' ? c.target
              : typeof c.nextId === 'string' ? c.nextId
              : ''
          }))
      }
    })
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
