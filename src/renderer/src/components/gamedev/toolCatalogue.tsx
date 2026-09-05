import React from 'react'
import {
  Sparkles, Repeat, Maximize2, Sliders, Grid, Scissors, Layers, GitFork, Palette
} from 'lucide-react'
import type { GameDevTab } from './types'

export interface GameDevToolMeta {
  id: GameDevTab
  label: string
  /** One line, shown on the launcher card. What it does, not how. */
  blurb: string
  icon: React.ReactNode
}

export interface GameDevToolGroup {
  group: string
  tools: GameDevToolMeta[]
}

/**
 * Every tool in the workspace, in one place.
 *
 * The launcher, the switcher and the header all read from this. They used to
 * each carry their own copy of the labels and icons, which is how a tool could
 * be renamed in one and not the other.
 */
export const GAMEDEV_TOOLS: GameDevToolGroup[] = [
  {
    group: 'Textures',
    tools: [
      { id: 'pbr', label: 'PBR Maps', blurb: 'Estimate normal, height, roughness and AO from one albedo.', icon: <Sparkles size={16} /> },
      { id: 'seamless', label: 'Seamless Tiler', blurb: 'Make a texture repeat without a visible seam.', icon: <Repeat size={16} /> },
      { id: 'upscaler', label: 'Pixel Upscaler', blurb: 'Scale pixel art up without blurring it.', icon: <Maximize2 size={16} /> },
      { id: 'lut', label: 'LUT Grader', blurb: 'Grade a look and export it as a colour lookup table.', icon: <Sliders size={16} /> }
    ]
  },
  {
    group: 'Sprites',
    tools: [
      { id: 'atlas', label: 'Atlas Packer', blurb: 'Pack loose sprites into one sheet with a JSON map.', icon: <Grid size={16} /> },
      { id: 'slicer', label: 'Sprite Slicer', blurb: 'Cut a sheet back into frames on a grid.', icon: <Scissors size={16} /> }
    ]
  },
  {
    group: 'Pipeline',
    tools: [
      { id: 'renamer', label: 'Batch Renamer', blurb: 'Rename a folder of assets to a naming convention.', icon: <Layers size={16} /> },
      { id: 'dialogue', label: 'Dialogue Flow', blurb: 'Build a branching conversation and see it as a graph.', icon: <GitFork size={16} /> },
      { id: 'palette', label: 'Shader Palette', blurb: 'Pick a palette and copy it out as shader constants.', icon: <Palette size={16} /> }
    ]
  }
]

/** The one tool, wherever it sits. Undefined only for an id that no longer exists. */
export function findTool(id: GameDevTab): GameDevToolMeta | undefined {
  for (const section of GAMEDEV_TOOLS) {
    const hit = section.tools.find(t => t.id === id)
    if (hit) return hit
  }
  return undefined
}

/** Which group a tool belongs to, for the header's sense of place. */
export function groupOf(id: GameDevTab): string | undefined {
  return GAMEDEV_TOOLS.find(s => s.tools.some(t => t.id === id))?.group
}
