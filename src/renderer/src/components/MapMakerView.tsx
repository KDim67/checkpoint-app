//  MAP MAKER, Pre-production 2D level layout tool
//  Zones, Terrain, Objects, Paths, Annotations, and JSON/PNG export.

import React, {
  useState, useCallback, useEffect, useRef, useMemo, useId
} from 'react'
import {
  Map, Layers, Eye, EyeOff, Lock, Unlock, Copy, Trash2, Plus, Download,
  Upload, ChevronDown, ChevronRight, Pencil, Square, Circle, Triangle,
  MousePointer, Pipette, PaintBucket, Eraser, Minus, Settings, X, Check,
  AlertTriangle, FileJson, Image, Code, RotateCcw, RotateCw, ZoomIn, ZoomOut,
  Maximize, Crosshair, Move, GitFork, Star, Home, Package, Swords, Shield,
  BookOpen, Droplets, Flag, RefreshCw, Camera, MessageSquare
} from 'lucide-react'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'
import useFocusTrap from './ui/useFocusTrap'
import useEscapeKey from './ui/useEscapeKey'

// Types

type GridType = 'square' | 'hex' | 'isometric'
type LayerType = 'reference' | 'terrain' | 'zones' | 'objects' | 'paths' | 'annotations'
type ZoneShapeType = 'polygon' | 'rect' | 'ellipse'
type ToolId =
  | 'select' | 'brush' | 'rect' | 'ellipse' | 'polygon' | 'bucket'
  | 'eraser' | 'eyedropper' | 'magic_wand'
  | 'stamp' | 'scatter' | 'move' | 'delete_obj'
  | 'pen' | 'delete_node'
  | 'comment_pin'

interface MapSettings {
  mapId: string
  name: string
  gridType: GridType
  cellSize: number
  scaleLabel: string
  width: number
  height: number
  locked: boolean
  customTerrains?: { id: string; name: string; color: string }[]
  // Realistic terrain rendering
  realisticMode?: boolean
  noiseSeed?: number
  realisticBiome?: string
  realisticOctaves?: number
  realisticRoughness?: number
}

interface LayerDef {
  id: string
  name: string
  type: LayerType
  visible: boolean
  locked: boolean
  opacity: number
}

interface TerrainCell {
  col: number
  row: number
  /** for hex grids, col=q and row=r (axial coordinates) */
  type: string
}

interface ZoneDef {
  id: string
  type: string
  name: string
  color: string
  shape: ZoneShapeType
  points: [number, number][]
  properties: Record<string, string>
}

interface MapObject {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  scale: number
  properties: Record<string, string>
}

interface MapPath {
  id: string
  type: string
  points: [number, number][]
  properties: Record<string, string>
}

interface MapComment {
  id: string
  text: string
  x: number
  y: number
}

interface ZonePaletteEntry {
  id: string
  type: string
  name: string
  color: string
  defaultProperties: Record<string, string>
}

interface Checkpoint {
  id: string
  label: string
  timestamp: number
  snapshot: string
}

interface MapState {
  settings: MapSettings
  layers: LayerDef[]
  terrain: TerrainCell[]
  terrainCanvas?: string   // data-URL for realistic free-paint mode
  zones: ZoneDef[]
  objects: MapObject[]
  paths: MapPath[]
  comments: MapComment[]
}

// Default zone palette

const DEFAULT_ZONE_PALETTE: ZonePaletteEntry[] = [
  { id: 'zp_combat',    type: 'combat',    name: 'Combat',         color: '#E63946', defaultProperties: { difficulty: 'normal' } },
  { id: 'zp_safe',      type: 'safe',      name: 'Safe / Rest',    color: '#2DC653', defaultProperties: { respawn: 'true' } },
  { id: 'zp_puzzle',    type: 'puzzle',    name: 'Puzzle',         color: '#F4A261', defaultProperties: {} },
  { id: 'zp_loot',      type: 'loot',      name: 'Loot',           color: '#FFD166', defaultProperties: { tier: '1' } },
  { id: 'zp_boss',      type: 'boss',      name: 'Boss',           color: '#9B5DE5', defaultProperties: { difficulty: 'hard', music_cue: 'boss_theme' } },
  { id: 'zp_spawn',     type: 'spawn',     name: 'Spawn',          color: '#00B4D8', defaultProperties: {} },
  { id: 'zp_water',     type: 'water',     name: 'Water',          color: '#0077B6', defaultProperties: { traversable: 'swimming' } },
  { id: 'zp_narrative', type: 'narrative', name: 'Narrative',      color: '#A8DADC', defaultProperties: { trigger_event: '' } },
  { id: 'zp_restricted',type: 'restricted',name: 'Restricted',     color: '#D62828', defaultProperties: { reason: 'out_of_bounds' } },
  { id: 'zp_custom',    type: 'custom',    name: 'Custom',         color: '#8338EC', defaultProperties: {} },
]

// Simplex Noise (self-contained, no dependencies)

function createNoise() {
  const perm = new Uint8Array(512)
  const base = new Uint8Array(256)
  for (let i = 0; i < 256; i++) base[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]

  const G2 = (3 - Math.sqrt(3)) / 6
  const grad2 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]
  const dot2 = (g:[number,number], x:number, y:number) => g[0]*x + g[1]*y

  return (x: number, y: number): number => {
    const F2 = 0.5*(Math.sqrt(3)-1)
    const s = (x+y)*F2
    const i = Math.floor(x+s), j = Math.floor(y+s)
    const t = (i+j)*G2
    const X0=i-t, Y0=j-t
    const x0=x-X0, y0=y-Y0
    const i1=x0>y0?1:0, j1=x0>y0?0:1
    const x1=x0-i1+G2, y1=y0-j1+G2
    const x2=x0-1+2*G2, y2=y0-1+2*G2
    const ii=i&255, jj=j&255
    const gi0=perm[ii+perm[jj]]%8
    const gi1=perm[ii+i1+perm[jj+j1]]%8
    const gi2=perm[ii+1+perm[jj+1]]%8
    const t0=0.5-x0*x0-y0*y0, n0=t0<0?0:t0*t0*t0*t0*dot2(grad2[gi0],x0,y0)
    const t1=0.5-x1*x1-y1*y1, n1=t1<0?0:t1*t1*t1*t1*dot2(grad2[gi1],x1,y1)
    const t2=0.5-x2*x2-y2*y2, n2=t2<0?0:t2*t2*t2*t2*dot2(grad2[gi2],x2,y2)
    return 70*(n0+n1+n2)
  }
}

// Realistic Terrain Biomes

const REALISTIC_TERRAIN_TYPES = [
  { id: 'rt_deep_ocean',    name: 'Deep Ocean',    color: '#0d3b6e' },
  { id: 'rt_ocean',         name: 'Ocean',         color: '#1a78c2' },
  { id: 'rt_shallow_water', name: 'Shallow Water', color: '#4ab0e0' },
  { id: 'rt_beach',         name: 'Beach',         color: '#e8d5a0' },
  { id: 'rt_lowland',       name: 'Lowland',       color: '#5a9e4b' },
  { id: 'rt_forest',        name: 'Forest',        color: '#2e6b33' },
  { id: 'rt_highland',      name: 'Highland',      color: '#8b6914' },
  { id: 'rt_mountain',      name: 'Mountain',      color: '#7a7a7a' },
  { id: 'rt_snow_peak',     name: 'Snow Peak',     color: '#dff0ff' },
]

const BIOME_PRESETS: Record<string, { seaLevel: number; forestStart: number; mountainStart: number; peakStart: number; name: string; icon: string }> = {
  islands:    { seaLevel: 0.18, forestStart: 0.35, mountainStart: 0.62, peakStart: 0.82, name: 'Island Archipelago', icon: '🏝️' },
  continent:  { seaLevel: 0.08, forestStart: 0.28, mountainStart: 0.58, peakStart: 0.80, name: 'Continent',          icon: '🌍' },
  mountains:  { seaLevel: 0.02, forestStart: 0.22, mountainStart: 0.40, peakStart: 0.65, name: 'Mountain Range',     icon: '🏔️' },
  flat:       { seaLevel: 0.05, forestStart: 0.30, mountainStart: 0.75, peakStart: 0.92, name: 'Plains',             icon: '🌾' },
  frozen:     { seaLevel: 0.05, forestStart: 0.15, mountainStart: 0.35, peakStart: 0.50, name: 'Frozen Tundra',      icon: '❄️' },
}

// Seeded noise (deterministic from a seed number)

function createSeededNoise(seed: number) {
  const perm = new Uint8Array(512)
  const base = new Uint8Array(256)
  for (let i = 0; i < 256; i++) base[i] = i
  // seeded LCG shuffle
  let s = seed >>> 0
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1);
    [base[i], base[j]] = [base[j], base[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]
  const G2 = (3 - Math.sqrt(3)) / 6
  const grad2: [number,number][] = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]
  const dot2 = (g:[number,number], x:number, y:number) => g[0]*x + g[1]*y
  return (x: number, y: number): number => {
    const F2 = 0.5*(Math.sqrt(3)-1)
    const ss = (x+y)*F2
    const i = Math.floor(x+ss), j = Math.floor(y+ss)
    const t = (i+j)*G2
    const X0=i-t, Y0=j-t
    const x0=x-X0, y0=y-Y0
    const i1=x0>y0?1:0, j1=x0>y0?0:1
    const x1=x0-i1+G2, y1=y0-j1+G2
    const x2=x0-1+2*G2, y2=y0-1+2*G2
    const ii=i&255, jj=j&255
    const gi0=perm[ii+perm[jj]]%8
    const gi1=perm[ii+i1+perm[jj+j1]]%8
    const gi2=perm[ii+1+perm[jj+1]]%8
    const t0=0.5-x0*x0-y0*y0, n0=t0<0?0:t0*t0*t0*t0*dot2(grad2[gi0],x0,y0)
    const t1=0.5-x1*x1-y1*y1, n1=t1<0?0:t1*t1*t1*t1*dot2(grad2[gi1],x1,y1)
    const t2=0.5-x2*x2-y2*y2, n2=t2<0?0:t2*t2*t2*t2*dot2(grad2[gi2],x2,y2)
    return 70*(n0+n1+n2)
  }
}

// Parse hex color to RGB

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}

function lerpRgb(a:[number,number,number], b:[number,number,number], t:number): [number,number,number] {
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]
}

// Pixel-level realistic terrain renderer

function drawRealisticTerrain(
  ctx: CanvasRenderingContext2D,
  settings: MapSettings,
  opacity: number
) {
  const { width, height, noiseSeed = 42, realisticBiome = 'continent', realisticOctaves = 6, realisticRoughness = 1.0 } = settings
  const W = width, H = height

  const preset = BIOME_PRESETS[realisticBiome] || BIOME_PRESETS.continent
  const { seaLevel, forestStart, mountainStart, peakStart } = preset

  // Noise functions - use seed-offset for variety
  const n1 = createSeededNoise(noiseSeed)
  const n2 = createSeededNoise(noiseSeed + 1337)
  const n3 = createSeededNoise(noiseSeed + 9999)

  // Color stops: [elevation, rgb]
  const colorStops: [number, [number,number,number]][] = [
    [0,              hexToRgb('#06234a')],  // abyssal
    [seaLevel*0.45,  hexToRgb('#0d3b6e')],  // deep ocean
    [seaLevel*0.75,  hexToRgb('#1a5a9a')],  // ocean
    [seaLevel*0.95,  hexToRgb('#2a8abf')],  // shallow
    [seaLevel,       hexToRgb('#4ab0e0')],  // very shallow / coast
    [seaLevel+0.025, hexToRgb('#e8d5a0')],  // wet sand
    [seaLevel+0.06,  hexToRgb('#d4bc82')],  // dry sand
    [seaLevel+0.09,  hexToRgb('#c8d89a')],  // scrubland
    [forestStart*0.5+seaLevel*0.5, hexToRgb('#6db86a')], // light grass
    [forestStart,    hexToRgb('#4a9e50')],  // meadow
    [forestStart+0.05, hexToRgb('#2e7a34')], // forest
    [mountainStart*0.7+forestStart*0.3, hexToRgb('#1a5c20')], // dense forest
    [mountainStart,  hexToRgb('#8b7355')],  // highland scrub
    [mountainStart+0.04, hexToRgb('#7a6a50')], // rocky highland
    [peakStart*0.6+mountainStart*0.4, hexToRgb('#9a9a9a')], // rock
    [peakStart,      hexToRgb('#c0c0c0')],  // snowy rock
    [peakStart+0.03, hexToRgb('#dff0ff')],  // snow
    [1.01,           hexToRgb('#ffffff')],  // pure peak
  ]

  const getTerrainColor = (e: number): [number,number,number] => {
    e = Math.max(0, Math.min(1, e))
    for (let i = 0; i < colorStops.length - 1; i++) {
      const [e0, c0] = colorStops[i]
      const [e1, c1] = colorStops[i + 1]
      if (e <= e1) {
        const t = (e - e0) / (e1 - e0)
        return lerpRgb(c0, c1, Math.max(0, Math.min(1, t)))
      }
    }
    return colorStops[colorStops.length - 1][1]
  }

  // Sample elevation at world (px, py) coords
  const baseScale = 0.0018 * (1 / realisticRoughness)
  const sampleElevation = (px: number, py: number): number => {
    let elevation = 0, amplitude = 1, freq = baseScale, maxAmp = 0
    for (let o = 0; o < realisticOctaves; o++) {
      elevation += n1(px * freq, py * freq) * amplitude
      elevation += n2(px * freq * 1.7 + 500, py * freq * 1.7 + 500) * amplitude * 0.4
      elevation += n3(px * freq * 0.5 - 200, py * freq * 0.5 - 200) * amplitude * 0.25
      maxAmp += amplitude * 1.65
      amplitude *= 0.5
      freq *= 2.1
    }
    let e = (elevation / maxAmp) * 0.5 + 0.5

    // Radial gradient for islands/continent shape
    if (realisticBiome === 'islands' || realisticBiome === 'continent') {
      const nx = (px / W) * 2 - 1
      const ny = (py / H) * 2 - 1
      const dist = Math.sqrt(nx * nx + ny * ny)
      const falloff = realisticBiome === 'islands' ? 1.1 : 0.65
      e = Math.max(0, e - dist * falloff)
    }
    return Math.max(0, Math.min(1, e))
  }

  // Render at lower resolution for performance, then scale up
  const SCALE = 2  // render every Nth pixel for speed
  const rW = Math.ceil(W / SCALE)
  const rH = Math.ceil(H / SCALE)

  const offscreen = new OffscreenCanvas(rW, rH)
  const offCtx = offscreen.getContext('2d')!
  const imgData = offCtx.createImageData(rW, rH)
  const data = imgData.data

  // Pre-compute elevation grid
  const elev = new Float32Array(rW * rH)
  for (let py = 0; py < rH; py++) {
    for (let px = 0; px < rW; px++) {
      elev[py * rW + px] = sampleElevation(px * SCALE, py * SCALE)
    }
  }

  // Write pixels
  for (let py = 0; py < rH; py++) {
    for (let px = 0; px < rW; px++) {
      const idx = py * rW + px
      const e = elev[idx]
      let [r, g, b] = getTerrainColor(e)

      // Slope shading (pseudo normal-map from neighbor elevations)
      const el = px > 0 ? elev[idx - 1] : e
      const er = px < rW-1 ? elev[idx + 1] : e
      const eu = py > 0 ? elev[idx - rW] : e
      const ed = py < rH-1 ? elev[idx + rW] : e
      const slopeX = er - el
      const slopeY = ed - eu
      // Directional light from top-left
      const shade = Math.max(0, Math.min(1, 0.5 + slopeX * 6 - slopeY * 4))
      if (e > seaLevel) {
        // Only shade land, not water
        r = Math.round(r * (0.78 + shade * 0.44))
        g = Math.round(g * (0.78 + shade * 0.44))
        b = Math.round(b * (0.78 + shade * 0.44))
      }

      // Shallow water shimmer near coast
      if (e > seaLevel * 0.8 && e < seaLevel + 0.015) {
        const shimmer = n3(px * 0.15, py * 0.15) * 0.5 + 0.5
        b = Math.min(255, Math.round(b + shimmer * 18))
        r = Math.min(255, Math.round(r + shimmer * 8))
      }

      // Deep ocean depth darkening
      if (e < seaLevel * 0.3) {
        const depth = 1 - (e / (seaLevel * 0.3))
        r = Math.round(r * (1 - depth * 0.4))
        g = Math.round(g * (1 - depth * 0.4))
        b = Math.round(b * (1 - depth * 0.35))
      }

      // Clamp
      r = Math.max(0, Math.min(255, r))
      g = Math.max(0, Math.min(255, g))
      b = Math.max(0, Math.min(255, b))

      const di = idx * 4
      data[di]   = r
      data[di+1] = g
      data[di+2] = b
      data[di+3] = 255
    }
  }

  offCtx.putImageData(imgData, 0, 0)

  // Scale up to full canvas size with smooth interpolation
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(offscreen, 0, 0, W, H)

  // Subtle parchment vignette overlay
  const vignette = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.3, W/2, H/2, Math.max(W,H)*0.72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  ctx.restore()
}

// Legacy grid-based terrain generator (used when NOT in realistic mode)

function generateRealisticTerrain(settings: MapSettings, biome: string, octaves: number, roughness: number): { terrain: TerrainCell[]; customTerrains: {id: string; name: string; color: string}[] } {
  // This path is no longer used for rendering in realisticMode, kept for
  // backwards compat (e.g. export / zone snapping to terrain type)
  return { terrain: [], customTerrains: REALISTIC_TERRAIN_TYPES.map(t => ({ ...t })) }
}


const TERRAIN_TYPES = ['grass', 'water', 'sand', 'rock', 'dirt', 'snow', 'lava', 'void']

// Realistic free-paint color palette
const REALISTIC_PAINT_COLORS = [
  { id: 'rp_deep_ocean',   name: 'Deep Ocean',    color: '#0d3b6e' },
  { id: 'rp_ocean',        name: 'Ocean',         color: '#1a5a9a' },
  { id: 'rp_shallow',      name: 'Shallow Water', color: '#4ab0e0' },
  { id: 'rp_beach',        name: 'Beach',         color: '#e8d5a0' },
  { id: 'rp_grass',        name: 'Grass',         color: '#6db86a' },
  { id: 'rp_forest',       name: 'Forest',        color: '#2e7a34' },
  { id: 'rp_jungle',       name: 'Jungle',        color: '#1a5220' },
  { id: 'rp_highland',     name: 'Highland',      color: '#8b7355' },
  { id: 'rp_mountain',     name: 'Mountain',      color: '#7a7a7a' },
  { id: 'rp_snow',         name: 'Snow Peak',     color: '#dff0ff' },
  { id: 'rp_desert',       name: 'Desert',        color: '#d4a55a' },
  { id: 'rp_savanna',      name: 'Savanna',       color: '#c8b560' },
  { id: 'rp_lava',         name: 'Lava',          color: '#c0392b' },
  { id: 'rp_swamp',        name: 'Swamp',         color: '#4a6741' },
  { id: 'rp_tundra',       name: 'Tundra',        color: '#a8c4b8' },
]

function paintRealisticBrush(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colorId: string,
  size: number,
  isEraser: boolean
) {
  ctx.save()
  const radius = size / 2
  const grad = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius)
  
  let hexColor = '#0d3b6e' // deep ocean as default/eraser
  if (!isEraser) {
    const entry = REALISTIC_PAINT_COLORS.find(c => c.id === colorId)
    if (entry) hexColor = entry.color
  }
  
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  
  grad.addColorStop(0, `rgba(${r},${g},${b},1.0)`)
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.8)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0.0)`)
  
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const TERRAIN_COLORS: Record<string, string> = {
  grass: '#3a7d44', water: '#1a78c2', sand: '#c9a84c', rock: '#7a7a7a',
  dirt: '#8b5e3c', snow: '#d6eaf8', lava: '#e74c3c', void: '#1a1a2e'
}

const OBJECT_TYPES = [
  { id: 'spawn_point', label: 'Spawn', icon: '⭐', color: '#00B4D8' },
  { id: 'boss',        label: 'Boss',  icon: '💀', color: '#9B5DE5' },
  { id: 'chest',       label: 'Chest', icon: '📦', color: '#FFD166' },
  { id: 'npc',         label: 'NPC',   icon: '🧑', color: '#2DC653' },
  { id: 'portal',      label: 'Portal',icon: '🌀', color: '#F4A261' },
  { id: 'enemy',       label: 'Enemy', icon: '⚔️', color: '#E63946' },
  { id: 'camera',      label: 'Camera',icon: '📷', color: '#A8DADC' },
  { id: 'marker',      label: 'Marker',icon: '📍', color: '#FF6B6B' },
]

// Layer tools mapping

const LAYER_TOOLS: Record<LayerType, ToolId[]> = {
  reference:   [],
  terrain:     ['brush', 'rect', 'ellipse', 'bucket', 'eraser', 'magic_wand', 'eyedropper'],
  zones:       ['select', 'brush', 'polygon', 'rect', 'ellipse', 'eyedropper'],
  objects:     ['select', 'stamp', 'scatter', 'delete_obj'],
  paths:       ['select', 'pen', 'delete_node'],
  annotations: ['comment_pin', 'move', 'delete_obj'],
}

// ID generation

let _idCounter = 1
const genId = (prefix: string) => `${prefix}_${Date.now()}_${_idCounter++}`

// Default map state

const makeDefaultMap = (settings: MapSettings): MapState => ({
  settings,
  layers: [
    { id: 'l_ref',   name: 'Reference',   type: 'reference',   visible: true,  locked: false, opacity: 0.5 },
    { id: 'l_terrain',name: 'Terrain',    type: 'terrain',     visible: true,  locked: false, opacity: 1.0 },
    { id: 'l_zones', name: 'Zones',       type: 'zones',       visible: true,  locked: false, opacity: 0.65 },
    { id: 'l_obj',   name: 'Objects',     type: 'objects',     visible: true,  locked: false, opacity: 1.0 },
    { id: 'l_paths', name: 'Paths',       type: 'paths',       visible: true,  locked: false, opacity: 0.9 },
    { id: 'l_ann',   name: 'Annotations', type: 'annotations', visible: true,  locked: false, opacity: 1.0 },
  ],
  terrain: [],
  zones: [],
  objects: [],
  paths: [],
  comments: [],
})

// Unity C# importer generator

function generateUnityScript(): string {
  return `//
// MapMakerImporter.cs, generated by Map Maker (Checkpoint App)
// Drop this file anywhere inside your Unity project's Assets/ folder.
// Usage: Edit menu → Map Maker → Import Map JSON
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEditor;

public class MapMakerImporter : EditorWindow
{
    [Serializable] class MapRoot   { public string mapId; public string name; public float cellSize; public float width; public float height; public List<ZoneData> zones; public List<ObjData> objects; public List<PathData> paths; }
    [Serializable] class ZoneData  { public string id; public string type; public string name; public string color; public List<List<float>> points; public Dictionary<string,string> properties; }
    [Serializable] class ObjData   { public string id; public string type; public float x; public float y; public float rotation; public float scale; public Dictionary<string,string> properties; }
    [Serializable] class PathData  { public string id; public string type; public List<List<float>> points; public Dictionary<string,string> properties; }

    public float scaleFactor = 100f;   // pixels per Unity world unit
    public bool  idMatchMode = false;  // false = clear-and-rebuild (default)
    public List<PrefabMapping> prefabMappings = new List<PrefabMapping>();

    [Serializable]
    public class PrefabMapping { public string objectType; public GameObject prefab; }

    string jsonPath = "";

    [MenuItem("Window/Map Maker/Import Map JSON")]
    public static void ShowWindow() => GetWindow<MapMakerImporter>("Map Maker Import");

    void OnGUI()
    {
        GUILayout.Label("Map Maker Importer", EditorStyles.boldLabel);
        EditorGUILayout.Space();

        GUILayout.BeginHorizontal();
        jsonPath = EditorGUILayout.TextField("JSON Path", jsonPath);
        if (GUILayout.Button("Browse", GUILayout.Width(60)))
            jsonPath = EditorUtility.OpenFilePanel("Select Map JSON", "", "json");
        GUILayout.EndHorizontal();

        scaleFactor = EditorGUILayout.FloatField("Scale Factor (px / unit)", scaleFactor);
        idMatchMode = EditorGUILayout.Toggle("ID-Match Mode (preserve tweaks)", idMatchMode);

        EditorGUILayout.Space();
        if (GUILayout.Button("Import Map", GUILayout.Height(36)))
            Import();
    }

    void Import()
    {
        if (!File.Exists(jsonPath)) { Debug.LogError("[MapMaker] JSON file not found: " + jsonPath); return; }
        var raw = File.ReadAllText(jsonPath);
        var map = JsonUtility.FromJson<MapRoot>(raw);

        // --- 1. Find or create root container ---
        string rootName = "MapMaker_" + map.mapId;
        var root = GameObject.Find(rootName);
        if (!idMatchMode && root != null) { DestroyImmediate(root); root = null; }
        if (root == null) root = new GameObject(rootName);

        float canvasH = map.height;

        // Helper: canvas px → Unity world (Y flipped)
        Vector2 ToUnity(float cx, float cy) => new Vector2(cx / scaleFactor, (canvasH - cy) / scaleFactor);
        // Zones points list
        Vector2[] ToUnityPoints(List<List<float>> pts) {
            var arr = new Vector2[pts.Count];
            for (int i = 0; i < pts.Count; i++) arr[i] = ToUnity(pts[i][0], pts[i][1]);
            return arr;
        }

        // --- 2. Zones → trigger colliders ---
        var zonesGO = GetOrCreateChild(root, "Zones", idMatchMode);
        foreach (var z in map.zones ?? new List<ZoneData>())
        {
            string goName = "Zone_" + z.id;
            var go = idMatchMode ? FindOrCreateChild(zonesGO, goName) : new GameObject(goName);
            go.transform.SetParent(zonesGO.transform, false);

            var pts = ToUnityPoints(z.points);
            if (pts.Length == 4 && IsRect(pts))
            {
                var col = go.GetOrAddComponent<BoxCollider2D>();
                col.isTrigger = true;
                var min = pts[0]; var max = pts[2];
                col.offset = (min + max) / 2f;
                col.size   = new Vector2(Mathf.Abs(max.x - min.x), Mathf.Abs(max.y - min.y));
            }
            else
            {
                var col = go.GetOrAddComponent<PolygonCollider2D>();
                col.isTrigger = true;
                col.SetPath(0, pts);
            }

            var meta = go.GetOrAddComponent<ZoneMetadata>();
            meta.zoneId   = z.id;
            meta.zoneName = z.name;
            meta.zoneType = z.type;
            if (z.properties != null)
                foreach (var kv in z.properties) meta.SetProperty(kv.Key, kv.Value);

            EditorUtility.SetDirty(go);
        }

        // --- 3. Objects → prefabs or placeholders ---
        var objsGO = GetOrCreateChild(root, "Objects", idMatchMode);
        foreach (var o in map.objects ?? new List<ObjData>())
        {
            string goName = "Obj_" + o.id;
            var go = idMatchMode ? FindOrCreateChild(objsGO, goName) : null;
            if (go == null)
            {
                var pref = prefabMappings?.Find(m => m.objectType == o.type)?.prefab;
                go = pref != null ? (GameObject)PrefabUtility.InstantiatePrefab(pref, objsGO.transform)
                                  : new GameObject(goName);
            }
            go.name = goName;
            go.transform.SetParent(objsGO.transform, false);
            go.transform.localPosition = new Vector3(ToUnity(o.x, o.y).x, ToUnity(o.x, o.y).y, 0f);
            // Canvas rotation is clockwise degrees; Unity 2D is CCW
            go.transform.localRotation = Quaternion.Euler(0f, 0f, -o.rotation);
            go.transform.localScale    = new Vector3(o.scale, o.scale, 1f);
            EditorUtility.SetDirty(go);
        }

        // --- 4. Paths → LineRenderers ---
        var pathsGO = GetOrCreateChild(root, "Paths", idMatchMode);
        foreach (var p in map.paths ?? new List<PathData>())
        {
            string goName = "Path_" + p.id;
            var go = idMatchMode ? FindOrCreateChild(pathsGO, goName) : new GameObject(goName);
            go.name = goName;
            go.transform.SetParent(pathsGO.transform, false);
            var lr = go.GetOrAddComponent<LineRenderer>();
            lr.positionCount = p.points.Count;
            for (int i = 0; i < p.points.Count; i++)
            {
                var uv = ToUnity(p.points[i][0], p.points[i][1]);
                lr.SetPosition(i, new Vector3(uv.x, uv.y, 0f));
            }
            lr.useWorldSpace = false;
            EditorUtility.SetDirty(go);
        }

        EditorUtility.SetDirty(root);
        Selection.activeGameObject = root;
        Debug.Log($"[MapMaker] Imported map '{map.name}' → '{rootName}'");
    }

    static bool IsRect(Vector2[] pts) => pts.Length == 4;

    static GameObject GetOrCreateChild(GameObject parent, string name, bool preserve)
    {
        if (!preserve) return new GameObject(name) { transform = { parent = parent.transform } };
        var t = parent.transform.Find(name);
        if (t != null) { foreach (Transform c in t) DestroyImmediate(c.gameObject); return t.gameObject; }
        return new GameObject(name) { transform = { parent = parent.transform } };
    }

    static GameObject FindOrCreateChild(GameObject parent, string name)
    {
        var t = parent.transform.Find(name);
        return t != null ? t.gameObject : new GameObject(name) { transform = { parent = parent.transform } };
    }
}

// ZoneMetadata MonoBehaviour
public class ZoneMetadata : MonoBehaviour
{
    public string zoneId;
    public string zoneName;
    public string zoneType;
    [SerializeField] List<string> propKeys = new List<string>();
    [SerializeField] List<string> propVals = new List<string>();
    public void SetProperty(string key, string val)
    {
        int i = propKeys.IndexOf(key);
        if (i >= 0) propVals[i] = val; else { propKeys.Add(key); propVals.Add(val); }
    }
    public string GetProperty(string key)
    {
        int i = propKeys.IndexOf(key); return i >= 0 ? propVals[i] : null;
    }
}

// Extension helpers
public static class GOExtensions
{
    public static T GetOrAddComponent<T>(this GameObject go) where T : Component
        => go.GetComponent<T>() ?? go.AddComponent<T>();
}
#endif`
}

// Serializer

function serializeMap(state: MapState): string {
  const { settings, terrain, terrainCanvas, zones, objects, paths, comments } = state
  return JSON.stringify({
    mapId: settings.mapId,
    name: settings.name,
    gridType: settings.gridType,
    cellSize: settings.cellSize,
    scaleLabel: settings.scaleLabel,
    width: settings.width,
    height: settings.height,
    customTerrains: settings.customTerrains,
    realisticMode: settings.realisticMode,
    noiseSeed: settings.noiseSeed,
    realisticBiome: settings.realisticBiome,
    realisticOctaves: settings.realisticOctaves,
    realisticRoughness: settings.realisticRoughness,
    terrain,
    terrainCanvas,
    zones,
    objects,
    paths,
    comments,
  }, null, 2)
}

function deserializeMap(json: string): MapState | null {
  try {
    const d = JSON.parse(json)
    const settings: MapSettings = {
      mapId: d.mapId || genId('map'),
      name: d.name || 'Untitled Map',
      gridType: d.gridType || 'square',
      cellSize: d.cellSize || 32,
      scaleLabel: d.scaleLabel || '1 cell = 1m',
      width: d.width || 1600,
      height: d.height || 1200,
      locked: true,
      customTerrains: d.customTerrains,
      realisticMode: d.realisticMode,
      noiseSeed: d.noiseSeed,
      realisticBiome: d.realisticBiome,
      realisticOctaves: d.realisticOctaves,
      realisticRoughness: d.realisticRoughness,
    }
    return {
      settings,
      layers: makeDefaultMap(settings).layers,
      terrain: d.terrain || [],
      terrainCanvas: d.terrainCanvas,
      zones: d.zones || [],
      objects: d.objects || [],
      paths: d.paths || [],
      comments: d.comments || [],
    }
  } catch { return null }
}

// Douglas-Peucker simplification

function rdp(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts
  let maxD = 0, idx = 0
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy)
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len === 0 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
      : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > eps) {
    return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)]
  }
  return [pts[0], pts[pts.length - 1]]
}

// Grid helpers

function snapToGrid(wx: number, wy: number, settings: MapSettings): [number, number] {
  const { gridType, cellSize } = settings
  if (gridType === 'square') {
    return [Math.round(wx / cellSize) * cellSize, Math.round(wy / cellSize) * cellSize]
  }
  if (gridType === 'hex') {
    // flat-topped hex: convert world → axial, round, convert back
    const q = (2 / 3 * wx) / cellSize
    const r = (-1 / 3 * wx + Math.sqrt(3) / 3 * wy) / cellSize
    const [rq, rr, rs] = hexRound(q, r)
    const sx = cellSize * 3 / 2 * rq
    const sy = cellSize * Math.sqrt(3) * (rr + rq / 2)
    return [sx, sy]
  }
  if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const col = Math.floor(wx / tw + wy / th - 0.5)
    const row = Math.floor(wy / th - wx / tw + 0.5)
    return [(col - row) * tw / 2 + tw / 2, (col + row) * th / 2 + th / 2]
  }
  return [wx, wy]
}

function hexRound(q: number, r: number): [number, number, number] {
  const s = -q - r
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  else rs = -rq - rr
  return [rq, rr, rs]
}

function worldToCell(wx: number, wy: number, settings: MapSettings): [number, number] {
  const { gridType, cellSize } = settings
  if (gridType === 'hex') {
    const q = (2 / 3 * wx) / cellSize
    const r = (-1 / 3 * wx + Math.sqrt(3) / 3 * wy) / cellSize
    const [rq, rr] = hexRound(q, r)
    return [rq, rr + Math.floor(rq / 2)]
  }
  if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    return [
      Math.floor(wx / tw + wy / th - 0.5),
      Math.floor(wy / th - wx / tw + 0.5)
    ]
  }
  return [Math.floor(wx / cellSize), Math.floor(wy / cellSize)]
}

// Canvas draw helpers

function drawGrid(ctx: CanvasRenderingContext2D, settings: MapSettings, W: number, H: number) {
  const { gridType, cellSize } = settings
  ctx.clearRect(0, 0, W, H)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 0.5

  if (gridType === 'square') {
    for (let x = 0; x <= W; x += cellSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = 0; y <= H; y += cellSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
  } else if (gridType === 'hex') {
    const r = cellSize
    const w = 2 * r, h = Math.sqrt(3) * r
    const cols = Math.ceil(W / (w * 0.75)) + 2
    const rows = Math.ceil(H / h) + 2
    for (let col = -1; col < cols; col++) {
      for (let row = -1; row < rows; row++) {
        const cx = col * w * 0.75
        const cy = row * h + (col % 2 === 0 ? 0 : h / 2)
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 180 * (60 * i)
          const vx = cx + r * Math.cos(angle)
          const vy = cy + r * Math.sin(angle)
          i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
        }
        ctx.closePath(); ctx.stroke()
      }
    }
  } else if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const diagW = Math.ceil(W / (tw / 2)) + 4
    const diagH = Math.ceil(H / (th / 2)) + 4
    for (let i = -diagH; i < diagW + diagH; i++) {
      ctx.beginPath()
      ctx.moveTo(i * tw / 2 - diagH * tw / 2, 0)
      ctx.lineTo(i * tw / 2 + diagH * tw / 2, diagH * th)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i * tw / 2, 0)
      ctx.lineTo(i * tw / 2 - (W + H), W + H)
      ctx.stroke()
    }
  }
}

function drawTerrainCell(
  ctx: CanvasRenderingContext2D,
  col: number, row: number,
  type: string,
  settings: MapSettings,
  opacity: number
) {
  const { gridType, cellSize, customTerrains } = settings
  let color = TERRAIN_COLORS[type] || '#555'
  if (!TERRAIN_COLORS[type] && customTerrains) {
    const found = customTerrains.find(c => c.id === type || c.name === type)
    if (found) color = found.color
  }
  ctx.globalAlpha = opacity
  ctx.fillStyle = color

  if (gridType === 'square') {
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize)
  } else if (gridType === 'hex') {
    const r = cellSize
    const w = 2 * r, h = Math.sqrt(3) * r
    const cx = col * w * 0.75
    const cy = row * h + (col % 2 === 0 ? 0 : h / 2)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i)
      const vx = cx + r * Math.cos(angle)
      const vy = cy + r * Math.sin(angle)
      i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy)
    }
    ctx.closePath(); ctx.fill()
  } else if (gridType === 'isometric') {
    const tw = cellSize * 2, th = cellSize
    const sx = (col - row) * tw / 2
    const sy = (col + row) * th / 2
    ctx.beginPath()
    ctx.moveTo(sx, sy + th / 2)
    ctx.lineTo(sx + tw / 2, sy)
    ctx.lineTo(sx + tw, sy + th / 2)
    ctx.lineTo(sx + tw / 2, sy + th)
    ctx.closePath(); ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  zone: ZoneDef,
  opacity: number,
  selected: boolean
) {
  if (zone.points.length < 2) return
  const hexColor = zone.color
  const r = parseInt(hexColor.slice(1,3),16)
  const g = parseInt(hexColor.slice(3,5),16)
  const b = parseInt(hexColor.slice(5,7),16)

  ctx.beginPath()
  if (zone.shape === 'ellipse' && zone.points.length === 2) {
    const [ax, ay] = zone.points[0], [bx, by] = zone.points[1]
    const rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2
    ctx.ellipse(ax + (bx-ax)/2, ay + (by-ay)/2, rx, ry, 0, 0, Math.PI * 2)
  } else {
    ctx.moveTo(zone.points[0][0], zone.points[0][1])
    for (let i = 1; i < zone.points.length; i++)
      ctx.lineTo(zone.points[i][0], zone.points[i][1])
    ctx.closePath()
  }

  ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.4})`
  ctx.fill()
  ctx.strokeStyle = selected ? '#ffffff' : `rgba(${r},${g},${b},${opacity})`
  ctx.lineWidth = selected ? 2.5 : 1.5
  ctx.stroke()

  if (selected) {
    // Draw resize/move handles on bounding box
    const xs = zone.points.map(p => p[0]), ys = zone.points.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const handles = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
      [(minX+maxX)/2, minY], [(minX+maxX)/2, maxY],
      [minX, (minY+maxY)/2], [maxX, (minY+maxY)/2],
    ]
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#1e45fc'
    ctx.lineWidth = 1.5
    handles.forEach(([hx, hy]) => {
      ctx.beginPath()
      ctx.rect(hx - 4, hy - 4, 8, 8)
      ctx.fill(); ctx.stroke()
    })
  }
}

function getObjectHandles(o: MapObject) {
  const size = 20
  const rotRad = (o.rotation * Math.PI) / 180
  const cos = Math.cos(rotRad)
  const sin = Math.sin(rotRad)

  const localToWorld = (lx: number, ly: number): [number, number] => {
    return [
      o.x + (lx * cos - ly * sin) * o.scale,
      o.y + (lx * sin + ly * cos) * o.scale
    ]
  }

  return {
    rotate: localToWorld(0, -(size + 18)),
    scaleCorners: [
      localToWorld(-(size + 8), -(size + 8)), // top-left
      localToWorld(size + 8, -(size + 8)),  // top-right
      localToWorld(size + 8, size + 8),   // bottom-right
      localToWorld(-(size + 8), size + 8)  // bottom-left
    ]
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: MapObject,
  selected: boolean,
  scale: number
) {
  const typeDef = OBJECT_TYPES.find(t => t.id === obj.type) || OBJECT_TYPES[7]
  const size = 20

  ctx.save()
  ctx.translate(obj.x, obj.y)
  ctx.rotate((obj.rotation * Math.PI) / 180)
  ctx.scale(obj.scale, obj.scale)

  // Background circle
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = typeDef.color + '44'
  ctx.fill()
  ctx.strokeStyle = typeDef.color
  ctx.lineWidth = 2
  ctx.stroke()

  // Icon text
  ctx.font = `${size}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(typeDef.icon, 0, 1)

  if (selected) {
    // Selection ring
    ctx.beginPath()
    ctx.arc(0, 0, size + 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    // Rotate handle
    ctx.beginPath()
    ctx.moveTo(0, -(size + 6))
    ctx.lineTo(0, -(size + 18))
    ctx.strokeStyle = '#cdf12b'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, -(size + 18), 5, 0, Math.PI * 2)
    ctx.fillStyle = '#cdf12b'
    ctx.fill()

    // Scale handles (4 corners of bounding box)
    const hw = size + 8
    ;[[-hw,-hw],[hw,-hw],[hw,hw],[-hw,hw]].forEach(([hx,hy]) => {
      ctx.beginPath()
      ctx.rect(hx - 4, hy - 4, 8, 8)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#1e45fc'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }

  ctx.restore()
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  path: MapPath,
  selected: boolean
) {
  if (path.points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(path.points[0][0], path.points[0][1])
  for (let i = 1; i < path.points.length; i++)
    ctx.lineTo(path.points[i][0], path.points[i][1])
  ctx.strokeStyle = selected ? '#cdf12b' : 'rgba(205,241,43,0.7)'
  ctx.lineWidth = selected ? 3 : 2
  ctx.setLineDash(selected ? [] : [8, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Node dots
  path.points.forEach(([px, py], i) => {
    ctx.beginPath()
    ctx.arc(px, py, selected ? 6 : 4, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#2DC653' : (selected ? '#cdf12b' : 'rgba(205,241,43,0.7)')
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
  })
}

function drawComment(
  ctx: CanvasRenderingContext2D,
  comment: MapComment,
  selected: boolean
) {
  const size = 18
  ctx.save()
  ctx.translate(comment.x, comment.y)

  // Pin circle
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = selected ? '#1e45fc' : 'rgba(30,69,252,0.8)'
  ctx.fill()
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Comment icon
  ctx.font = `${size}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('💬', 0, 1)

  // Text label
  if (comment.text) {
    const label = comment.text.length > 20 ? comment.text.slice(0, 20) + '…' : comment.text
    ctx.font = '10px Inter, sans-serif'
    ctx.textAlign = 'left'
    const tw = ctx.measureText(label).width + 8
    ctx.fillStyle = 'rgba(13,16,34,0.9)'
    ctx.fillRect(size + 4, -10, tw, 20)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillText(label, size + 8, 1)
  }

  ctx.restore()
}

// Point-in-polygon (ray casting)

function pointInPolygon(px: number, py: number, pts: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Main Component

export default function MapMakerView() {
  const { toast } = useToast()
  const confirm = useConfirm()

  // Maps & pages
  const [maps, setMaps] = useState<MapState[]>([])
  const [activeMapIdx, setActiveMapIdx] = useState(0)
  const [showNewMapWizard, setShowNewMapWizard] = useState(false)
  const [showUnityModal, setShowUnityModal] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState<{x:number,y:number}|null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  
  // Custom terrain modal states
  const [showAddCustomTerrainModal, setShowAddCustomTerrainModal] = useState(false)
  const [newTerrainName, setNewTerrainName] = useState('')
  const [newTerrainColor, setNewTerrainColor] = useState('#8338EC')

  // Inline tab rename states
  const [renameMapIdx, setRenameMapIdx] = useState<number|null>(null)
  const [renameInputName, setRenameInputName] = useState('')

  // Wizard form
  const [wizardName, setWizardName]         = useState('Untitled Map')
  const [wizardGrid, setWizardGrid]         = useState<GridType>('square')
  const [wizardCellSize, setWizardCellSize] = useState(32)
  const [wizardW, setWizardW]               = useState(1600)
  const [wizardH, setWizardH]               = useState(1200)
  const [wizardScale, setWizardScale]       = useState('1 cell = 1m')
  const [wizardRealistic, setWizardRealistic] = useState(false)
  const [wizardBiome, setWizardBiome]         = useState('continent')
  const [wizardOctaves, setWizardOctaves]     = useState(6)
  const [wizardRoughness, setWizardRoughness] = useState(1.0)

  // Active state
  const activeMap = maps[activeMapIdx]
  const setActiveMap = useCallback((updater: (s: MapState) => MapState) => {
    setMaps(prev => prev.map((m, i) => i === activeMapIdx ? updater(m) : m))
  }, [activeMapIdx])

  // Layers & tools
  const [activeLayerType, setActiveLayerType] = useState<LayerType>('zones')
  const [activeTool, setActiveTool] = useState<ToolId>('select')
  const [activeZonePaletteId, setActiveZonePaletteId] = useState(DEFAULT_ZONE_PALETTE[0].id)
  const [zonePalette, setZonePalette] = useState<ZonePaletteEntry[]>(DEFAULT_ZONE_PALETTE)
  const [activeTerrainType, setActiveTerrainType] = useState('grass')
  const [realisticPaintColor, setRealisticPaintColor] = useState(REALISTIC_PAINT_COLORS[4].id) // default: Grass
  const [realisticBrushSize, setRealisticBrushSize] = useState(80)
  const [realisticEraser, setRealisticEraser] = useState(false)
  const isPaintingRealistic = useRef(false)
  const justFinishedPainting = useRef(false)
  const lastRealisticPos = useRef<[number,number]|null>(null)

  const realisticPaintColorRef = useRef(realisticPaintColor)
  const realisticBrushSizeRef = useRef(realisticBrushSize)
  const realisticEraserRef = useRef(realisticEraser)

  useEffect(() => { realisticPaintColorRef.current = realisticPaintColor }, [realisticPaintColor])
  useEffect(() => { realisticBrushSizeRef.current = realisticBrushSize }, [realisticBrushSize])
  useEffect(() => { realisticEraserRef.current = realisticEraser }, [realisticEraser])
  const [activeObjectType, setActiveObjectType] = useState(OBJECT_TYPES[0].id)
  const [brushSize, setBrushSize] = useState(32)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [symmetryH, setSymmetryH] = useState(false)
  const [symmetryV, setSymmetryV] = useState(false)

  // Selection
  const [selectedZoneId, setSelectedZoneId]    = useState<string|null>(null)
  const [selectedObjectId, setSelectedObjectId]= useState<string|null>(null)
  const [selectedPathId, setSelectedPathId]    = useState<string|null>(null)
  const [selectedCommentId, setSelectedCommentId] = useState<string|null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hoverCoord, setHoverCoord] = useState<[number, number] | null>(null)

  // Canvas view (pan/zoom)
  const [panX, setPanX] = useState(24)
  const [panY, setPanY] = useState(24)
  const [zoom, setZoom] = useState(1)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 })

  // Drawing state (mouse)
  const isDrawing = useRef(false)
  const polygonPoints = useRef<[number,number][]>([])
  const brushStroke = useRef<[number,number][]>([])
  const pathDraftPoints = useRef<[number,number][]>([])
  const dragStart = useRef<[number,number]|null>(null)
  const dragTarget = useRef<string|null>(null)
  const terrainDraft = useRef<TerrainCell[]>([])
  const lastPaintPos = useRef<[number,number]|null>(null)
  const dragNodeIndex = useRef<number|null>(null)
  const dragMode = useRef<'move' | 'rotate' | 'scale'>('move')

  // Canvas refs
  const containerRef   = useRef<HTMLDivElement>(null)
  const bgCanvasRef    = useRef<HTMLCanvasElement>(null)
  const terrainCanvasRef= useRef<HTMLCanvasElement>(null)
  const vectorCanvasRef= useRef<HTMLCanvasElement>(null)
  const previewCanvasRef= useRef<HTMLCanvasElement>(null)
  const gridCanvasRef  = useRef<HTMLCanvasElement>(null)

  // Undo/Redo
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])

  // Checkpoints
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [checkpointLabel, setCheckpointLabel] = useState('')

  // Refs for panel inspector editing
  const [inspectorKey, setInspectorKey] = useState(0)

  // Compute canvas size from map settings
  const canvasW = activeMap?.settings.width  ?? 1600
  const canvasH = activeMap?.settings.height ?? 1200

  // Convert screen → world coordinates
  const screenToWorld = useCallback((sx: number, sy: number): [number, number] => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    return [(sx - rect.left - panX) / zoom, (sy - rect.top - panY) / zoom]
  }, [panX, panY, zoom])

  const pushUndo = useCallback(() => {
    if (!activeMap) return
    undoStack.current.push(serializeMap(activeMap))
    if (undoStack.current.length > 60) undoStack.current.shift()
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [activeMap])

  const commitRename = useCallback(() => {
    if (renameMapIdx === null) return
    const idx = renameMapIdx
    const nextName = renameInputName.trim()
    setRenameMapIdx(null)
    if (!nextName || nextName === maps[idx].settings.name) return
    if (maps.some((x, i) => i !== idx && x.settings.name.toLowerCase() === nextName.toLowerCase())) {
      toast('A map with that name already exists', { type: 'warning' })
      return
    }
    pushUndo()
    setMaps(prev => prev.map((x, i) => i === idx ? { ...x, settings: { ...x.settings, name: nextName } } : x))
  }, [renameMapIdx, renameInputName, maps, pushUndo])

  const undo = useCallback(() => {
    if (!undoStack.current.length || !activeMap) return
    redoStack.current.push(serializeMap(activeMap))
    const snap = undoStack.current.pop()!
    const restored = deserializeMap(snap)
    if (restored) setActiveMap(() => restored)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }, [activeMap, setActiveMap])

  const redo = useCallback(() => {
    if (!redoStack.current.length || !activeMap) return
    undoStack.current.push(serializeMap(activeMap))
    const snap = redoStack.current.pop()!
    const restored = deserializeMap(snap)
    if (restored) setActiveMap(() => restored)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
  }, [activeMap, setActiveMap])

  // Draw grid overlay
  useEffect(() => {
    const canvas = gridCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    if (activeMap.settings.realisticMode) {
      ctx.clearRect(0, 0, canvasW, canvasH)  // no grid for realistic maps
    } else {
      drawGrid(ctx, activeMap.settings, canvasW, canvasH)
    }
  }, [activeMap?.settings, canvasW, canvasH])

  // Redraw terrain cache
  useEffect(() => {
    const canvas = terrainCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    const terrainLayer = activeMap.layers.find(l => l.type === 'terrain')

    if (activeMap.settings.realisticMode) {
      // Skip if we just finished a paint stroke (canvas already up to date)
      if (justFinishedPainting.current) {
        justFinishedPainting.current = false
        return
      }
      if (!terrainLayer?.visible) {
        ctx.clearRect(0, 0, canvasW, canvasH)
        return
      }
      if (activeMap.terrainCanvas) {
        // Load stored painting from data URL
        const img = new window.Image()
        img.onload = () => {
          ctx.clearRect(0, 0, canvasW, canvasH)
          ctx.globalAlpha = terrainLayer.opacity
          ctx.drawImage(img, 0, 0)
          ctx.globalAlpha = 1
        }
        img.src = activeMap.terrainCanvas
      } else {
        // Initialize with deep ocean background
        ctx.clearRect(0, 0, canvasW, canvasH)
        ctx.globalAlpha = terrainLayer.opacity
        ctx.fillStyle = '#0d3b6e'
        ctx.fillRect(0, 0, canvasW, canvasH)
        ctx.globalAlpha = 1
      }
    } else {
      ctx.clearRect(0, 0, canvasW, canvasH)
      if (!terrainLayer?.visible) return
      activeMap.terrain.forEach(cell => {
        drawTerrainCell(ctx, cell.col, cell.row, cell.type, activeMap.settings, terrainLayer.opacity)
      })
    }
  }, [activeMap?.terrain, activeMap?.terrainCanvas, activeMap?.layers, activeMap?.settings, canvasW, canvasH])

  // Redraw vector canvas (zones, paths, objects, comments)
  useEffect(() => {
    const canvas = vectorCanvasRef.current
    if (!canvas || !activeMap) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvasW, canvasH)

    const layer = (type: LayerType) => activeMap.layers.find(l => l.type === type)

    const zonesLayer = layer('zones')
    if (zonesLayer?.visible) {
      activeMap.zones.forEach(z => drawZone(ctx, z, zonesLayer.opacity, z.id === selectedZoneId))
    }
    const pathsLayer = layer('paths')
    if (pathsLayer?.visible) {
      activeMap.paths.forEach(p => drawPath(ctx, p, p.id === selectedPathId))
    }
    const objsLayer = layer('objects')
    if (objsLayer?.visible) {
      activeMap.objects.forEach(o => drawObject(ctx, o, o.id === selectedObjectId, zoom))
    }
    const annLayer = layer('annotations')
    if (annLayer?.visible) {
      activeMap.comments.forEach(c => drawComment(ctx, c, c.id === selectedCommentId))
    }
  }, [activeMap, selectedZoneId, selectedPathId, selectedObjectId, selectedCommentId, canvasW, canvasH, zoom])

  // Load all maps from disk on startup
  useEffect(() => {
    const loadAllMaps = async () => {
      try {
        const names = await window.electronAPI.maps.listMaps()
        const loaded: MapState[] = []
        for (const name of names) {
          const json = await window.electronAPI.maps.readMap(name)
          const mapState = deserializeMap(json)
          if (mapState) loaded.push(mapState)
        }
        if (loaded.length > 0) {
          setMaps(loaded)
          setActiveMapIdx(0)
        }
      } catch (err) {
        console.error('Failed to load maps from folder:', err)
      }
    }
    loadAllMaps()
  }, [])

  // Auto-save active map to disk
  const lastSavedName = useRef<string|null>(null)

  useEffect(() => {
    if (activeMap) {
      if (lastSavedName.current === null) {
        lastSavedName.current = activeMap.settings.name
      }
    } else {
      lastSavedName.current = null
    }
  }, [activeMapIdx, maps.length])

  useEffect(() => {
    if (!activeMap) return
    const saveToDisk = async () => {
      try {
        const json = serializeMap(activeMap)
        const currentName = activeMap.settings.name

        // If the name changed, delete the old file name on disk!
        if (lastSavedName.current && lastSavedName.current !== currentName) {
          await window.electronAPI.maps.deleteMap(lastSavedName.current)
        }

        await window.electronAPI.maps.writeMap(currentName, json)
        lastSavedName.current = currentName
      } catch (err) {
        console.error('Failed to auto-save map to disk:', err)
      }
    }
    const timer = setTimeout(saveToDisk, 500)
    return () => clearTimeout(timer)
  }, [activeMap])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo() }
      if (e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedZoneId) deleteZone(selectedZoneId)
        else if (selectedObjectId) deleteObject(selectedObjectId)
        else if (selectedPathId) deletePath(selectedPathId)
        else if (selectedCommentId) deleteComment(selectedCommentId)
      }
      if (e.key === 'Escape') {
        polygonPoints.current = []
        pathDraftPoints.current = []
        clearPreview()
      }
      if (e.key === 'Enter') {
        if (activeTool === 'pen' && pathDraftPoints.current.length >= 2) {
          pushUndo()
          setActiveMap(s => ({
            ...s,
            paths: [...s.paths, {
              id: genId('p'),
              type: 'patrol',
              points: [...pathDraftPoints.current],
              properties: {}
            }]
          }))
          pathDraftPoints.current = []
          clearPreview()
        } else if (activeTool === 'polygon' && polygonPoints.current.length >= 3) {
          const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
          if (activePalette) {
            pushUndo()
            setActiveMap(s => ({
              ...s,
              zones: [...s.zones, {
                id: genId('z'),
                type: activePalette.type,
                name: activePalette.name,
                color: activePalette.color,
                shape: 'polygon',
                points: [...polygonPoints.current],
                properties: { ...activePalette.defaultProperties }
              }]
            }))
            polygonPoints.current = []
            clearPreview()
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedZoneId, selectedObjectId, selectedPathId, selectedCommentId, undo, redo,
      activeTool, activeZonePaletteId, zonePalette, setActiveMap])

  // Preview canvas clear
  const clearPreview = () => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    canvas.getContext('2d')!.clearRect(0, 0, canvasW, canvasH)
  }

  // Delete helpers
  const deleteZone = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, zones: s.zones.filter(z => z.id !== id) })); setSelectedZoneId(null) }
  const deleteObject = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, objects: s.objects.filter(o => o.id !== id) })); setSelectedObjectId(null) }
  const deletePath = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, paths: s.paths.filter(p => p.id !== id) })); setSelectedPathId(null) }
  const deleteComment = (id: string) => { pushUndo(); setActiveMap(s => ({ ...s, comments: s.comments.filter(c => c.id !== id) })); setSelectedCommentId(null) }

  // Mouse event handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeMap) return

    // Pan: space held or middle button
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true
      panStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY }
      return
    }
    if (e.button !== 0) return

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled && activeTool !== 'select' && activeLayerType !== 'terrain' && !activeMap.settings.realisticMode) {
      [wx, wy] = snapToGrid(wx, wy, activeMap.settings)
    }

    const settings = activeMap.settings

    // ZONES layer
    if (activeLayerType === 'zones') {
      if (activeTool === 'select') {
        let hit: ZoneDef | null = null
        // Hit test: iterate zones in reverse (topmost first)
        for (let i = activeMap.zones.length - 1; i >= 0; i--) {
          const z = activeMap.zones[i]
          if (z.shape === 'ellipse' && z.points.length === 2) {
            const [ax, ay] = z.points[0], [bx, by] = z.points[1]
            const rx = Math.abs(bx-ax)/2, ry = Math.abs(by-ay)/2
            const cx = ax+(bx-ax)/2, cy = ay+(by-ay)/2
            if (((wx-cx)/rx)**2 + ((wy-cy)/ry)**2 <= 1) { hit = z; break }
          } else {
            if (pointInPolygon(wx, wy, z.points)) { hit = z; break }
          }
        }
        if (hit) {
          pushUndo()
          setSelectedZoneId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        } else {
          setSelectedZoneId(null)
        }
        return
      }
      if (activeTool === 'eyedropper') {
        for (let i = activeMap.zones.length - 1; i >= 0; i--) {
          const z = activeMap.zones[i]
          const match = zonePalette.find(p => p.type === z.type)
          if (match && pointInPolygon(wx, wy, z.points)) {
            setActiveZonePaletteId(match.id); break
          }
        }
        return
      }
      if (activeTool === 'polygon') {
        const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
        // Double-click to close
        if (e.detail === 2 && polygonPoints.current.length >= 3 && activePalette) {
          pushUndo()
          setActiveMap(s => ({
            ...s,
            zones: [...s.zones, {
              id: genId('z'),
              type: activePalette.type,
              name: activePalette.name,
              color: activePalette.color,
              shape: 'polygon',
              points: [...polygonPoints.current],
              properties: { ...activePalette.defaultProperties }
            }]
          }))
          polygonPoints.current = []; clearPreview(); return
        }
        polygonPoints.current.push([wx, wy])
        
        // Immediate feedback: draw the placed dots
        const previewCtx = previewCanvasRef.current?.getContext('2d')
        if (previewCtx && activePalette) {
          previewCtx.clearRect(0, 0, canvasW, canvasH)
          previewCtx.strokeStyle = activePalette.color
          previewCtx.lineWidth = 1.5
          previewCtx.setLineDash([4,3])
          previewCtx.beginPath()
          previewCtx.moveTo(polygonPoints.current[0][0], polygonPoints.current[0][1])
          polygonPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
          previewCtx.lineTo(wx, wy)
          previewCtx.stroke()
          previewCtx.setLineDash([])

          polygonPoints.current.forEach(([px, py]) => {
            previewCtx.beginPath()
            previewCtx.arc(px, py, 4, 0, Math.PI * 2)
            previewCtx.fillStyle = activePalette.color
            previewCtx.fill()
            previewCtx.strokeStyle = '#000'
            previewCtx.lineWidth = 1
            previewCtx.stroke()
          })
        }
        return
      }
      if (activeTool === 'brush' || activeTool === 'rect' || activeTool === 'ellipse') {
        isDrawing.current = true
        brushStroke.current = [[wx, wy]]
        dragStart.current = [wx, wy]
        return
      }
    }

    // TERRAIN layer
    if (activeLayerType === 'terrain') {
      // Realistic free-paint mode
      if (settings.realisticMode) {
        pushUndo()
        isPaintingRealistic.current = true
        isDrawing.current = true
        lastRealisticPos.current = [wx, wy]
        const canvas = terrainCanvasRef.current
        if (canvas) {
          const ctx = canvas.getContext('2d')!
          paintRealisticBrush(ctx, wx, wy, realisticPaintColorRef.current, realisticBrushSizeRef.current, realisticEraserRef.current)
        }
        return
      }

      if (activeTool === 'eyedropper') {
        const [col, row] = worldToCell(wx, wy, settings)
        const cell = activeMap.terrain.find(c => c.col === col && c.row === row)
        if (cell) setActiveTerrainType(cell.type)
        return
      }
      if (activeTool === 'bucket') {
        // Flood fill BFS
        pushUndo()
        const [startCol, startRow] = worldToCell(wx, wy, settings)
        const target = activeMap.terrain.find(c => c.col === startCol && c.row === startRow)
        const targetType = target?.type || 'void'
        if (targetType === activeTerrainType) return

        const isWithinBounds = (cCol: number, cRow: number) => {
          let cx = 0, cy = 0
          if (settings.gridType === 'square') {
            cx = cCol * settings.cellSize + settings.cellSize / 2
            cy = cRow * settings.cellSize + settings.cellSize / 2
          } else if (settings.gridType === 'hex') {
            const r = settings.cellSize
            const w = 2 * r, h = Math.sqrt(3) * r
            cx = cCol * w * 0.75
            cy = cRow * h + (cCol % 2 === 0 ? 0 : h / 2)
          } else if (settings.gridType === 'isometric') {
            const tw = settings.cellSize * 2, th = settings.cellSize
            cx = (cCol - cRow) * tw / 2
            cy = (cCol + cRow) * th / 2
          }
          return cx >= 0 && cx <= canvasW && cy >= 0 && cy <= canvasH
        }

        const getNeighbors = (cCol: number, cRow: number) => {
          if (settings.gridType === 'hex') {
            return [
              [cCol + 1, cRow],
              [cCol - 1, cRow],
              [cCol, cRow + 1],
              [cCol, cRow - 1],
              [cCol + 1, cRow - 1],
              [cCol - 1, cRow + 1]
            ]
          }
          return [
            [cCol + 1, cRow],
            [cCol - 1, cRow],
            [cCol, cRow + 1],
            [cCol, cRow - 1]
          ]
        }

        const visited = new Set<string>()
        const queue: [number,number][] = [[startCol, startRow]]
        const newCells: TerrainCell[] = []
        while (queue.length) {
          const [col, row] = queue.shift()!
          const key = `${col},${row}`
          if (visited.has(key)) continue
          visited.add(key)
          const existing = activeMap.terrain.find(c => c.col === col && c.row === row)
          if ((existing?.type || 'void') !== targetType) continue
          if (!isWithinBounds(col, row)) continue
          newCells.push({ col, row, type: activeTerrainType })
          queue.push(...getNeighbors(col, row))
        }
        setActiveMap(s => {
          const remaining = s.terrain.filter(c => !visited.has(`${c.col},${c.row}`))
          return { ...s, terrain: [...remaining, ...newCells] }
        })
        return
      }
      if (activeTool === 'magic_wand') {
        const [startCol, startRow] = worldToCell(wx, wy, settings)
        const target = activeMap.terrain.find(c => c.col === startCol && c.row === startRow)
        if (!target) return
        
        const targetType = target.type
        const visited = new Set<string>()
        const queue: [number, number][] = [[startCol, startRow]]
        const connected: TerrainCell[] = []

        const getNeighbors = (cCol: number, cRow: number) => {
          if (settings.gridType === 'hex') {
            return [
              [cCol + 1, cRow],
              [cCol - 1, cRow],
              [cCol, cRow + 1],
              [cCol, cRow - 1],
              [cCol + 1, cRow - 1],
              [cCol - 1, cRow + 1]
            ]
          }
          return [
            [cCol + 1, cRow],
            [cCol - 1, cRow],
            [cCol, cRow + 1],
            [cCol, cRow - 1]
          ]
        }

        while (queue.length) {
          const [col, row] = queue.shift()!
          const key = `${col},${row}`
          if (visited.has(key)) continue
          visited.add(key)
          
          const cell = activeMap.terrain.find(c => c.col === col && c.row === row)
          if (cell && cell.type === targetType) {
            connected.push(cell)
            queue.push(...getNeighbors(col, row))
          }
        }

        if (connected.length === 0) return

        const edgeMap = new Map<string, [ [number, number], [number, number] ]>()
        const key = (p: [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
        const edgeKey = (p1: [number, number], p2: [number, number]) => `${key(p1)}->${key(p2)}`

        connected.forEach(cell => {
          const corners: [number, number][] = []
          if (settings.gridType === 'square') {
            const x1 = cell.col * settings.cellSize
            const x2 = (cell.col + 1) * settings.cellSize
            const y1 = cell.row * settings.cellSize
            const y2 = (cell.row + 1) * settings.cellSize
            corners.push([x1, y1], [x2, y1], [x2, y2], [x1, y2])
          } else if (settings.gridType === 'isometric') {
            const tw = settings.cellSize * 2, th = settings.cellSize
            const sx = (cell.col - cell.row) * tw / 2
            const sy = (cell.col + cell.row) * th / 2
            corners.push(
              [sx + tw / 2, sy],
              [sx + tw, sy + th / 2],
              [sx + tw / 2, sy + th],
              [sx, sy + th / 2]
            )
          } else if (settings.gridType === 'hex') {
            const r = settings.cellSize
            const w = 2 * r, h = Math.sqrt(3) * r
            const cx = cell.col * w * 0.75
            const cy = cell.row * h + (cell.col % 2 === 0 ? 0 : h / 2)
            for (let i = 0; i < 6; i++) {
              const angle = Math.PI / 180 * (60 * i)
              corners.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
            }
          }

          for (let i = 0; i < corners.length; i++) {
            const p1 = corners[i]
            const p2 = corners[(i + 1) % corners.length]
            edgeMap.set(edgeKey(p1, p2), [p1, p2])
          }
        })

        const boundaryEdges: [ [number, number], [number, number] ][] = []
        edgeMap.forEach(([p1, p2], ek) => {
          const revKey = edgeKey(p2, p1)
          if (!edgeMap.has(revKey)) {
            boundaryEdges.push([p1, p2])
          }
        })

        if (boundaryEdges.length === 0) return

        const loops: [number, number][][] = []
        const used = new Set<number>()

        while (used.size < boundaryEdges.length) {
          let startIdx = -1
          for (let i = 0; i < boundaryEdges.length; i++) {
            if (!used.has(i)) { startIdx = i; break }
          }
          if (startIdx === -1) break

          const loop: [number, number][] = []
          let currIdx = startIdx
          let currentEdge = boundaryEdges[currIdx]
          loop.push(currentEdge[0])
          used.add(currIdx)

          let steps = 0
          const maxSteps = boundaryEdges.length * 2
          while (steps < maxSteps) {
            const endPt = currentEdge[1]
            let nextIdx = -1
            for (let i = 0; i < boundaryEdges.length; i++) {
              if (!used.has(i)) {
                const nextEdge = boundaryEdges[i]
                if (Math.hypot(nextEdge[0][0] - endPt[0], nextEdge[0][1] - endPt[1]) < 0.1) {
                  nextIdx = i; break
                }
              }
            }

            if (nextIdx !== -1) {
              currIdx = nextIdx
              currentEdge = boundaryEdges[currIdx]
              loop.push(currentEdge[0])
              used.add(currIdx)
              steps++
            } else {
              const startPt = boundaryEdges[startIdx][0]
              if (Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]) < 0.1) {
                // Closed
              } else {
                loop.push(endPt)
              }
              break
            }
          }
          if (loop.length >= 3) {
            loop.push(loop[0]) // make sure it forms a fully closed path
            loops.push(loop)
          }
        }

        if (loops.length === 0) return
        loops.sort((a, b) => b.length - a.length)
        const outerBoundary = loops[0]

        pushUndo()
        const zoneName = `${targetType.charAt(0).toUpperCase() + targetType.slice(1)} Zone`
        const zoneColor = TERRAIN_COLORS[targetType] || settings.customTerrains?.find(c => c.name === targetType)?.color || '#cdf12b'

        const newZoneId = genId('z')
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: newZoneId,
            type: targetType,
            name: zoneName,
            color: zoneColor,
            shape: 'polygon',
            points: outerBoundary,
            properties: {}
          }]
        }))
        setActiveLayerType('zones')
        setSelectedZoneId(newZoneId)
        setActiveTool('select')
        return
      }
      if (activeTool === 'rect' || activeTool === 'ellipse') {
        isDrawing.current = true
        dragStart.current = [wx, wy]
        return
      }

      isDrawing.current = true
      pushUndo()
      terrainDraft.current = [...activeMap.terrain]
      lastPaintPos.current = [wx, wy]
      paintTerrainAt(wx, wy)
      return
    }

    // OBJECTS layer
    if (activeLayerType === 'objects') {
      if (activeTool === 'delete_obj') {
        let hit: MapObject | null = null
        for (let i = activeMap.objects.length - 1; i >= 0; i--) {
          const o = activeMap.objects[i]
          if (Math.hypot(wx - o.x, wy - o.y) < 24 * o.scale) { hit = o; break }
        }
        if (hit) {
          pushUndo()
          setActiveMap(s => ({ ...s, objects: s.objects.filter(o => o.id !== hit.id) }))
          setSelectedObjectId(null)
        }
        return
      }
      if (activeTool === 'select') {
        if (selectedObjectId) {
          const o = activeMap.objects.find(x => x.id === selectedObjectId)
          if (o) {
            const handles = getObjectHandles(o)
            
            // Check rotate handle
            if (Math.hypot(wx - handles.rotate[0], wy - handles.rotate[1]) < 12) {
              dragTarget.current = o.id
              dragMode.current = 'rotate'
              const mouseAngle = Math.atan2(wy - o.y, wx - o.x) * 180 / Math.PI
              dragStart.current = [mouseAngle - o.rotation, 0]
              isDrawing.current = true
              return
            }

            // Check scale corners
            for (let cIdx = 0; cIdx < 4; cIdx++) {
              const c = handles.scaleCorners[cIdx]
              if (Math.hypot(wx - c[0], wy - c[1]) < 12) {
                dragTarget.current = o.id
                dragMode.current = 'scale'
                const dist = Math.hypot(wx - o.x, wy - o.y)
                dragStart.current = [dist, o.scale]
                isDrawing.current = true
                return
              }
            }
          }
        }

        let hit: MapObject | null = null
        for (let i = activeMap.objects.length - 1; i >= 0; i--) {
          const o = activeMap.objects[i]
          if (Math.hypot(wx - o.x, wy - o.y) < 24 * o.scale) { hit = o; break }
        }
        if (hit) {
          pushUndo()
          setSelectedObjectId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          dragMode.current = 'move'
          isDrawing.current = true
        } else setSelectedObjectId(null)
        return
      }
      if (activeTool === 'stamp' || activeTool === 'scatter') {
        pushUndo()
        const newObj: MapObject = {
          id: genId('o'),
          type: activeObjectType,
          x: wx, y: wy,
          rotation: activeTool === 'scatter' ? Math.random() * 360 : 0,
          scale: activeTool === 'scatter' ? 0.7 + Math.random() * 0.6 : 1,
          properties: {}
        }
        setActiveMap(s => ({ ...s, objects: [...s.objects, newObj] }))
        if (activeTool === 'scatter') isDrawing.current = true
        return
      }
    }

    // PATHS layer
    if (activeLayerType === 'paths') {
      if (activeTool === 'delete_node') {
        let hitPath: MapPath | null = null
        let hitNodeIdx = -1
        for (let i = activeMap.paths.length - 1; i >= 0; i--) {
          const p = activeMap.paths[i]
          for (let j = 0; j < p.points.length; j++) {
            if (Math.hypot(wx - p.points[j][0], wy - p.points[j][1]) < 12) {
              hitPath = p; hitNodeIdx = j; break
            }
          }
          if (hitPath) break
        }
        if (hitPath && hitNodeIdx !== -1) {
          pushUndo()
          const newPoints = hitPath.points.filter((_, idx) => idx !== hitNodeIdx)
          if (newPoints.length < 2) {
            setActiveMap(s => ({ ...s, paths: s.paths.filter(p => p.id !== hitPath.id) }))
            setSelectedPathId(null)
          } else {
            setActiveMap(s => ({
              ...s,
              paths: s.paths.map(p => p.id === hitPath.id ? { ...p, points: newPoints } : p)
            }))
          }
        }
        return
      }
      if (activeTool === 'select') {
        // First check if click hit any of the nodes of the ALREADY selected path
        if (selectedPathId) {
          const p = activeMap.paths.find(x => x.id === selectedPathId)
          if (p) {
            let nodeHitIndex = -1
            for (let j = 0; j < p.points.length; j++) {
              if (Math.hypot(wx - p.points[j][0], wy - p.points[j][1]) < 12) {
                nodeHitIndex = j; break
              }
            }
            if (nodeHitIndex !== -1) {
              pushUndo()
              dragTarget.current = p.id
              dragNodeIndex.current = nodeHitIndex
              dragStart.current = [wx, wy]
              isDrawing.current = true
              return
            }
          }
        }

        let hit: MapPath | null = null
        for (let i = activeMap.paths.length - 1; i >= 0; i--) {
          const p = activeMap.paths[i]
          let onPath = false
          for (let j = 0; j < p.points.length - 1; j++) {
            if (distPointToSegment(wx, wy, p.points[j][0], p.points[j][1], p.points[j+1][0], p.points[j+1][1]) < 10) { onPath = true; break }
          }
          if (onPath) { hit = p; break }
        }
        if (hit) {
          pushUndo()
          setSelectedPathId(hit.id)
          setInspectorKey(k => k+1)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        } else setSelectedPathId(null)
        return
      }
      if (activeTool === 'pen') {
        if (e.detail === 2 && pathDraftPoints.current.length >= 2) {
          pushUndo()
          setActiveMap(s => ({
            ...s,
            paths: [...s.paths, {
              id: genId('p'),
              type: 'patrol',
              points: [...pathDraftPoints.current],
              properties: {}
            }]
          }))
          pathDraftPoints.current = []; clearPreview(); return
        }
        pathDraftPoints.current.push([wx, wy])
        
        // Immediate feedback: draw the placed waypoints
        const previewCtx = previewCanvasRef.current?.getContext('2d')
        if (previewCtx) {
          previewCtx.clearRect(0, 0, canvasW, canvasH)
          previewCtx.strokeStyle = 'rgba(205,241,43,0.8)'
          previewCtx.lineWidth = 2
          previewCtx.setLineDash([6,3])
          previewCtx.beginPath()
          previewCtx.moveTo(pathDraftPoints.current[0][0], pathDraftPoints.current[0][1])
          pathDraftPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
          previewCtx.lineTo(wx, wy)
          previewCtx.stroke()
          previewCtx.setLineDash([])

          pathDraftPoints.current.forEach(([px, py], i) => {
            previewCtx.beginPath()
            previewCtx.arc(px, py, i === 0 ? 5 : 4, 0, Math.PI * 2)
            previewCtx.fillStyle = i === 0 ? '#2DC653' : '#cdf12b'
            previewCtx.fill()
            previewCtx.strokeStyle = '#000'
            previewCtx.lineWidth = 1
            previewCtx.stroke()
          })
        }
        return
      }
    }

    // ANNOTATIONS layer
    if (activeLayerType === 'annotations') {
      if (activeTool === 'comment_pin') {
        setShowCommentModal({ x: wx, y: wy })
        return
      }
      if (activeTool === 'move') {
        let hit: MapComment | null = null
        for (let i = activeMap.comments.length - 1; i >= 0; i--) {
          const c = activeMap.comments[i]
          if (Math.hypot(wx - c.x, wy - c.y) < 24) { hit = c; break }
        }
        if (hit) {
          pushUndo()
          setSelectedCommentId(hit.id)
          dragStart.current = [wx, wy]
          dragTarget.current = hit.id
          isDrawing.current = true
        }
        return
      }
    }
  }, [activeMap, activeLayerType, activeTool, panX, panY, screenToWorld, snapEnabled,
      zonePalette, activeZonePaletteId, activeTerrainType, activeObjectType, pushUndo, setActiveMap])

  const paintTerrainAt = useCallback((wx: number, wy: number) => {
    if (!activeMap) return
    const [col, row] = worldToCell(wx, wy, activeMap.settings)
    if (activeTool === 'eraser') {
      terrainDraft.current = terrainDraft.current.filter(c => !(c.col === col && c.row === row))
    } else {
      const filtered = terrainDraft.current.filter(c => !(c.col === col && c.row === row))
      terrainDraft.current = [...filtered, { col, row, type: activeTerrainType }]
    }

    const canvas = terrainCanvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasW, canvasH)
        const terrainLayer = activeMap.layers.find(l => l.type === 'terrain')
        if (terrainLayer?.visible) {
          terrainDraft.current.forEach(cell => {
            drawTerrainCell(ctx, cell.col, cell.row, cell.type, activeMap.settings, terrainLayer.opacity)
          })
        }
      }
    }
  }, [activeMap, activeTerrainType, activeTool, canvasW, canvasH])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!activeMap) return

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled && activeLayerType !== 'terrain' && !activeMap.settings.realisticMode) [wx, wy] = snapToGrid(wx, wy, activeMap.settings)
    setHoverCoord([Math.round(wx), Math.round(wy)])

    if (isPanning.current) {
      setPanX(panStart.current.px + (e.clientX - panStart.current.x))
      setPanY(panStart.current.py + (e.clientY - panStart.current.y))
      return
    }
    if (!isDrawing.current && activeTool !== 'polygon' && activeTool !== 'pen') return

    const previewCtx = previewCanvasRef.current?.getContext('2d')
    if (previewCtx) {
      previewCtx.clearRect(0, 0, canvasW, canvasH)
      if (activeLayerType === 'terrain' && (activeTool === 'brush' || activeTool === 'eraser')) {
        const isRealistic = activeMap.settings.realisticMode
        const size = isRealistic ? realisticBrushSizeRef.current : activeMap.settings.cellSize
        const radius = size / 2
        previewCtx.save()
        previewCtx.beginPath()
        previewCtx.arc(wx, wy, radius, 0, Math.PI * 2)
        
        let color = '#ffffff'
        if (isRealistic) {
          if (realisticEraserRef.current) {
            color = '#e74c3c'
          } else {
            const entry = REALISTIC_PAINT_COLORS.find(c => c.id === realisticPaintColorRef.current)
            if (entry) color = entry.color
          }
        }
        
        previewCtx.strokeStyle = color
        previewCtx.lineWidth = 1.5
        previewCtx.stroke()
        previewCtx.fillStyle = 'rgba(255,255,255,0.08)'
        previewCtx.fill()
        previewCtx.restore()
      }
    }

    // Drag selected zone
    if (activeLayerType === 'zones' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        zones: s.zones.map(z => z.id === dragTarget.current
          ? { ...z, points: z.points.map(([px, py]) => [px + dx, py + dy] as [number,number]) }
          : z)
      }))
      return
    }
    // Drag selected object
    if (activeLayerType === 'objects' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      if (dragMode.current === 'move') {
        const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
        dragStart.current = [wx, wy]
        setActiveMap(s => ({
          ...s,
          objects: s.objects.map(o => o.id === dragTarget.current
            ? { ...o, x: o.x + dx, y: o.y + dy }
            : o)
        }))
      } else if (dragMode.current === 'rotate') {
        const startOffsetAngle = dragStart.current[0]
        const targetObj = activeMap.objects.find(x => x.id === dragTarget.current)
        if (targetObj) {
          const [uwx, uwy] = screenToWorld(e.clientX, e.clientY)
          const currentMouseAngle = Math.atan2(uwy - targetObj.y, uwx - targetObj.x) * 180 / Math.PI
          let nextRot = (currentMouseAngle - startOffsetAngle) % 360
          if (nextRot < 0) nextRot += 360
          setActiveMap(s => ({
            ...s,
            objects: s.objects.map(o => o.id === dragTarget.current ? { ...o, rotation: nextRot } : o)
          }))
        }
      } else if (dragMode.current === 'scale') {
        const [startDist, startScale] = dragStart.current
        const targetObj = activeMap.objects.find(x => x.id === dragTarget.current)
        if (targetObj) {
          const [uwx, uwy] = screenToWorld(e.clientX, e.clientY)
          const currentDist = Math.hypot(uwx - targetObj.x, uwy - targetObj.y)
          const scaleFactor = currentDist / Math.max(1, startDist)
          const nextScale = Math.max(0.1, Math.min(10, startScale * scaleFactor))
          setActiveMap(s => ({
            ...s,
            objects: s.objects.map(o => o.id === dragTarget.current ? { ...o, scale: nextScale } : o)
          }))
        }
      }
      return
    }
    // Drag selected path
    if (activeLayerType === 'paths' && activeTool === 'select' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      if (dragNodeIndex.current !== null) {
        const nodeIdx = dragNodeIndex.current
        setActiveMap(s => ({
          ...s,
          paths: s.paths.map(p => p.id === dragTarget.current
            ? {
                ...p,
                points: p.points.map((pt, idx) => idx === nodeIdx
                  ? [pt[0] + dx, pt[1] + dy] as [number, number]
                  : pt
                )
              }
            : p)
        }))
      } else {
        setActiveMap(s => ({
          ...s,
          paths: s.paths.map(p => p.id === dragTarget.current
            ? { ...p, points: p.points.map(([px, py]) => [px + dx, py + dy] as [number,number]) }
            : p)
        }))
      }
      return
    }
    // Drag annotation
    if (activeLayerType === 'annotations' && activeTool === 'move' && dragTarget.current && dragStart.current) {
      const dx = wx - dragStart.current[0], dy = wy - dragStart.current[1]
      dragStart.current = [wx, wy]
      setActiveMap(s => ({
        ...s,
        comments: s.comments.map(c => c.id === dragTarget.current
          ? { ...c, x: c.x + dx, y: c.y + dy }
          : c)
      }))
      return
    }
    // Scatter brush spray
    if (activeLayerType === 'objects' && activeTool === 'scatter' && Math.random() < 0.15) {
      const newObj: MapObject = {
        id: genId('o'), type: activeObjectType,
        x: wx + (Math.random()-0.5)*40, y: wy + (Math.random()-0.5)*40,
        rotation: Math.random()*360, scale: 0.7+Math.random()*0.6, properties: {}
      }
      setActiveMap(s => ({ ...s, objects: [...s.objects, newObj] }))
      return
    }
    // Terrain painting
    if (activeLayerType === 'terrain' && (activeTool === 'brush' || activeTool === 'eraser')) {
      // Realistic free-paint
      if (activeMap.settings.realisticMode && isPaintingRealistic.current) {
        const canvas = terrainCanvasRef.current
        if (canvas) {
          const ctx = canvas.getContext('2d')!
          if (lastRealisticPos.current) {
            // Interpolate between last pos and current for smooth strokes
            const [lx, ly] = lastRealisticPos.current
            const dist = Math.hypot(wx - lx, wy - ly)
            const steps = Math.max(1, Math.ceil(dist / (realisticBrushSizeRef.current * 0.25)))
            for (let i = 1; i <= steps; i++) {
              const t = i / steps
              paintRealisticBrush(ctx, lx + (wx-lx)*t, ly + (wy-ly)*t, realisticPaintColorRef.current, realisticBrushSizeRef.current, realisticEraserRef.current)
            }
          } else {
            paintRealisticBrush(ctx, wx, wy, realisticPaintColorRef.current, realisticBrushSizeRef.current, realisticEraserRef.current)
          }
          lastRealisticPos.current = [wx, wy]
        }
        return
      }
      if (lastPaintPos.current) {
        const [lastWx, lastWy] = lastPaintPos.current
        const dist = Math.hypot(wx - lastWx, wy - lastWy)
        const steps = Math.ceil(dist / (activeMap.settings.cellSize / 2))
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 0 : i / steps
          const ix = lastWx + (wx - lastWx) * t
          const iy = lastWy + (wy - lastWy) * t
          paintTerrainAt(ix, iy)
        }
      } else {
        paintTerrainAt(wx, wy)
      }
      lastPaintPos.current = [wx, wy]
      return
    }
    // Rect / ellipse preview
    if ((activeTool === 'rect' || activeTool === 'ellipse') && dragStart.current && previewCtx) {
      const [sx, sy] = dragStart.current
      let color = '#ffffff'
      if (activeLayerType === 'zones') {
        const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
        if (activePalette) color = activePalette.color
      } else if (activeLayerType === 'terrain') {
        const customColor = activeMap?.settings.customTerrains?.find(c => c.id === activeTerrainType || c.name === activeTerrainType)?.color
        color = TERRAIN_COLORS[activeTerrainType] || customColor || '#555555'
      }
      const r = parseInt(color.slice(1,3),16)
      const g = parseInt(color.slice(3,5),16)
      const b = parseInt(color.slice(5,7),16)
      previewCtx.fillStyle = `rgba(${r},${g},${b},0.25)`
      previewCtx.strokeStyle = `rgba(${r},${g},${b},0.9)`
      previewCtx.lineWidth = 1.5
      previewCtx.beginPath()
      if (activeTool === 'rect') {
        previewCtx.rect(sx, sy, wx-sx, wy-sy)
      } else {
        const cx = (sx+wx)/2, cy = (sy+wy)/2
        previewCtx.ellipse(cx, cy, Math.abs(wx-sx)/2, Math.abs(wy-sy)/2, 0, 0, Math.PI*2)
      }
      previewCtx.fill(); previewCtx.stroke()
      return
    }
    // Brush stroke freehand preview
    if (activeTool === 'brush' && activeLayerType === 'zones') {
      brushStroke.current.push([wx, wy])
      if (previewCtx && brushStroke.current.length > 1) {
        previewCtx.strokeStyle = zonePalette.find(p => p.id === activeZonePaletteId)?.color || '#fff'
        previewCtx.lineWidth = 2
        previewCtx.lineCap = 'round'
        previewCtx.lineJoin = 'round'
        previewCtx.beginPath()
        const pts = brushStroke.current
        previewCtx.moveTo(pts[0][0], pts[0][1])
        pts.forEach(([px,py]) => previewCtx.lineTo(px,py))
        previewCtx.stroke()
      }
      return
    }
    // Polygon preview line to cursor
    if (activeTool === 'polygon' && polygonPoints.current.length > 0 && previewCtx) {
      const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)
      previewCtx.strokeStyle = activePalette?.color || '#ffffff'
      previewCtx.lineWidth = 1.5
      previewCtx.setLineDash([4,3])
      previewCtx.beginPath()
      // Draw existing polygon
      previewCtx.moveTo(polygonPoints.current[0][0], polygonPoints.current[0][1])
      polygonPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
      previewCtx.lineTo(wx, wy)
      previewCtx.stroke()
      previewCtx.setLineDash([])

      // Draw vertex dots
      polygonPoints.current.forEach(([px, py]) => {
        previewCtx.beginPath()
        previewCtx.arc(px, py, 4, 0, Math.PI * 2)
        previewCtx.fillStyle = activePalette?.color || '#ffffff'
        previewCtx.fill()
        previewCtx.strokeStyle = '#000'
        previewCtx.lineWidth = 1
        previewCtx.stroke()
      })
      return
    }
    // Path pen preview
    if (activeTool === 'pen' && pathDraftPoints.current.length > 0 && previewCtx) {
      previewCtx.strokeStyle = 'rgba(205,241,43,0.8)'
      previewCtx.lineWidth = 2
      previewCtx.setLineDash([6,3])
      previewCtx.beginPath()
      previewCtx.moveTo(pathDraftPoints.current[0][0], pathDraftPoints.current[0][1])
      pathDraftPoints.current.forEach(([px,py]) => previewCtx.lineTo(px,py))
      previewCtx.lineTo(wx,wy)
      previewCtx.stroke()
      previewCtx.setLineDash([])

      // Draw waypoints
      pathDraftPoints.current.forEach(([px, py], i) => {
        previewCtx.beginPath()
        previewCtx.arc(px, py, i === 0 ? 5 : 4, 0, Math.PI * 2)
        previewCtx.fillStyle = i === 0 ? '#2DC653' : '#cdf12b'
        previewCtx.fill()
        previewCtx.strokeStyle = '#000'
        previewCtx.lineWidth = 1
        previewCtx.stroke()
      })
    }
  }, [activeMap, activeLayerType, activeTool, screenToWorld, snapEnabled, dragStart, zonePalette,
      activeZonePaletteId, activeObjectType, paintTerrainAt, canvasW, canvasH, setActiveMap, panX, panY])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanning.current) { isPanning.current = false; return }
    if (!isDrawing.current || !activeMap) { isDrawing.current = false; return }
    isDrawing.current = false

    let [wx, wy] = screenToWorld(e.clientX, e.clientY)
    if (snapEnabled && activeLayerType !== 'terrain' && !activeMap.settings.realisticMode) [wx, wy] = snapToGrid(wx, wy, activeMap.settings)

    const activePalette = zonePalette.find(p => p.id === activeZonePaletteId)

    if (activeLayerType === 'zones') {
      if (activeTool === 'rect' && dragStart.current && activePalette) {
        const [sx, sy] = dragStart.current
        if (Math.abs(wx-sx) < 4 && Math.abs(wy-sy) < 4) { clearPreview(); return }
        pushUndo()
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'rect',
            points: [[sx,sy],[wx,sy],[wx,wy],[sx,wy]],
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        clearPreview()
      }
      if (activeTool === 'ellipse' && dragStart.current && activePalette) {
        const [sx, sy] = dragStart.current
        if (Math.abs(wx-sx) < 4 && Math.abs(wy-sy) < 4) { clearPreview(); return }
        pushUndo()
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'ellipse',
            points: [[sx,sy],[wx,wy]],
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        clearPreview()
      }
      if (activeTool === 'brush' && brushStroke.current.length > 3 && activePalette) {
        pushUndo()
        const simplified = rdp(brushStroke.current, 6)
        setActiveMap(s => ({
          ...s,
          zones: [...s.zones, {
            id: genId('z'), type: activePalette.type, name: activePalette.name,
            color: activePalette.color, shape: 'polygon',
            points: simplified,
            properties: { ...activePalette.defaultProperties }
          }]
        }))
        brushStroke.current = []; clearPreview()
      }
      if (activeTool === 'select' && dragTarget.current) {
        // finalize move, already committed live, just push undo once
        dragTarget.current = null; dragStart.current = null
      }
    }

    if (activeLayerType === 'terrain') {
      // Realistic free-paint commit
      if (activeMap.settings.realisticMode && isPaintingRealistic.current) {
        isPaintingRealistic.current = false
        lastRealisticPos.current = null
        const canvas = terrainCanvasRef.current
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png')
          justFinishedPainting.current = true
          setActiveMap(s => ({ ...s, terrainCanvas: dataUrl }))
        }
        return
      }

      if ((activeTool === 'rect' || activeTool === 'ellipse') && dragStart.current) {
        const [sx, sy] = dragStart.current
        if (Math.abs(wx-sx) < 4 && Math.abs(wy-sy) < 4) { clearPreview(); return }
        
        pushUndo()

        const minX = Math.min(sx, wx), maxX = Math.max(sx, wx)
        const minY = Math.min(sy, wy), maxY = Math.max(sy, wy)
        const centerX = (sx + wx) / 2, centerY = (sy + wy) / 2
        const rx = Math.abs(wx - sx) / 2, ry = Math.abs(wy - sy) / 2

        const settings = activeMap.settings
        const corners = [
          worldToCell(minX, minY, settings),
          worldToCell(maxX, minY, settings),
          worldToCell(minX, maxY, settings),
          worldToCell(maxX, maxY, settings)
        ]
        const minCol = Math.min(...corners.map(c => c[0])) - 2
        const maxCol = Math.max(...corners.map(c => c[0])) + 2
        const minRow = Math.min(...corners.map(c => c[1])) - 2
        const maxRow = Math.max(...corners.map(c => c[1])) + 2

        const newCells: TerrainCell[] = []
        const affectedKeys = new Set<string>()

        for (let col = minCol; col <= maxCol; col++) {
          for (let row = minRow; row <= maxRow; row++) {
            let cx = 0, cy = 0
            if (settings.gridType === 'square') {
              cx = col * settings.cellSize + settings.cellSize / 2
              cy = row * settings.cellSize + settings.cellSize / 2
            } else if (settings.gridType === 'hex') {
              const r = settings.cellSize
              const w = 2 * r, h = Math.sqrt(3) * r
              cx = col * w * 0.75
              cy = row * h + (col % 2 === 0 ? 0 : h / 2)
            } else if (settings.gridType === 'isometric') {
              const tw = settings.cellSize * 2, th = settings.cellSize
              cx = (col - row) * tw / 2
              cy = (col + row) * th / 2
            }

            let inside = false
            if (activeTool === 'rect') {
              inside = cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
            } else {
              inside = ((cx - centerX) / rx) ** 2 + ((cy - centerY) / ry) ** 2 <= 1
            }

            if (inside) {
              newCells.push({ col, row, type: activeTerrainType })
              affectedKeys.add(`${col},${row}`)
            }
          }
        }

        setActiveMap(s => {
          const remaining = s.terrain.filter(c => !affectedKeys.has(`${c.col},${c.row}`))
          return { ...s, terrain: [...remaining, ...newCells] }
        })

        clearPreview()
      } else if (activeTool === 'brush' || activeTool === 'eraser') {
        setActiveMap(s => ({ ...s, terrain: terrainDraft.current }))
        lastPaintPos.current = null
      }
    }

    if (activeLayerType === 'objects') {
      if (activeTool === 'select' && dragTarget.current) {
        dragTarget.current = null; dragStart.current = null
      }
    }
    if (activeLayerType === 'paths') {
      if (activeTool === 'select' && dragTarget.current) {
        dragTarget.current = null; dragStart.current = null
        dragNodeIndex.current = null
      }
    }
    if (activeLayerType === 'annotations' && activeTool === 'move' && dragTarget.current) {
      dragTarget.current = null; dragStart.current = null
    }

    dragStart.current = null
  }, [activeMap, activeLayerType, activeTool, zonePalette, activeZonePaletteId, screenToWorld,
      snapEnabled, pushUndo, setActiveMap, activeTerrainType])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Calculate world coordinates under cursor before zoom
      const wx = (mouseX - panX) / zoom
      const wy = (mouseY - panY) / zoom

      const factor = e.deltaY < 0 ? 1.15 : 0.85
      const nextZoom = Math.max(0.15, Math.min(10, zoom * factor))

      setZoom(nextZoom)
      setPanX(mouseX - wx * nextZoom)
      setPanY(mouseY - wy * nextZoom)
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [panX, panY, zoom])

  // New map wizard
  const createMap = () => {
    const noiseSeed = Math.floor(Math.random() * 999999) + 1
    const settings: MapSettings = {
      mapId: genId('map'),
      name: wizardName,
      gridType: wizardGrid,
      cellSize: wizardCellSize,
      scaleLabel: wizardScale,
      width: wizardW,
      height: wizardH,
      locked: false,
      customTerrains: [],
      ...(wizardRealistic && {
        realisticMode: true,
        noiseSeed,
        realisticBiome: wizardBiome,
        realisticOctaves: wizardOctaves,
        realisticRoughness: wizardRoughness,
      })
    }
    const newMap = makeDefaultMap(settings)
    setMaps(prev => [...prev, newMap])
    setActiveMapIdx(maps.length)
    setShowNewMapWizard(false)
  }

  // Save checkpoint
  const saveCheckpoint = () => {
    if (!activeMap || !checkpointLabel.trim()) return
    setCheckpoints(prev => [...prev, {
      id: genId('cp'),
      label: checkpointLabel.trim(),
      timestamp: Date.now(),
      snapshot: serializeMap(activeMap)
    }])
    setCheckpointLabel('')
  }

  const restoreCheckpoint = (cp: Checkpoint) => {
    const restored = deserializeMap(cp.snapshot)
    if (restored) { pushUndo(); setActiveMap(() => restored) }
  }

  // Export
  const exportJSON = () => {
    if (!activeMap) return
    const json = serializeMap(activeMap)
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${activeMap.settings.mapId}.json`
    a.click()
  }

  const exportPNG = () => {
    if (!activeMap) return
    const offscreen = document.createElement('canvas')
    offscreen.width = canvasW; offscreen.height = canvasH
    const ctx = offscreen.getContext('2d')!
    // Composite all visible layers in order
    const canvases = [bgCanvasRef, terrainCanvasRef, vectorCanvasRef]
    canvases.forEach(ref => { if (ref.current) ctx.drawImage(ref.current, 0, 0) })
    const a = document.createElement('a')
    a.href = offscreen.toDataURL('image/png')
    a.download = `${activeMap.settings.mapId}.png`
    a.click()
  }

  const loadJSON = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const state = deserializeMap(ev.target?.result as string)
        if (state) {
          setMaps(prev => [...prev, state])
          setActiveMapIdx(maps.length)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Ensure valid tool when switching layers
  useEffect(() => {
    const validTools = LAYER_TOOLS[activeLayerType]
    if (validTools.length > 0 && !validTools.includes(activeTool)) {
      setActiveTool(validTools[0])
    }
  }, [activeLayerType])

  // Computed inspector data
  const selectedZone   = activeMap?.zones.find(z => z.id === selectedZoneId)
  const selectedObject = activeMap?.objects.find(o => o.id === selectedObjectId)
  const selectedPath   = activeMap?.paths.find(p => p.id === selectedPathId)
  const selectedComment= activeMap?.comments.find(c => c.id === selectedCommentId)

  // Tool labels
  const toolInfo: Record<ToolId, {label: string; icon: React.ReactNode}> = {
    select:      { label: 'Select', icon: <MousePointer size={13}/> },
    brush:       { label: 'Brush',  icon: <Pencil size={13}/> },
    rect:        { label: 'Rect',   icon: <Square size={13}/> },
    ellipse:     { label: 'Ellipse',icon: <Circle size={13}/> },
    polygon:     { label: 'Polygon',icon: <Triangle size={13}/> },
    bucket:      { label: 'Fill',   icon: <PaintBucket size={13}/> },
    eraser:      { label: 'Eraser', icon: <Eraser size={13}/> },
    eyedropper:  { label: 'Picker', icon: <Pipette size={13}/> },
    magic_wand:  { label: 'Wand',   icon: <Star size={13}/> },
    stamp:       { label: 'Stamp',  icon: <Package size={13}/> },
    scatter:     { label: 'Scatter',icon: <Crosshair size={13}/> },
    move:        { label: 'Move',   icon: <Move size={13}/> },
    delete_obj:  { label: 'Delete', icon: <Trash2 size={13}/> },
    pen:         { label: 'Pen',    icon: <GitFork size={13}/> },
    delete_node: { label: 'Del Node',icon: <Minus size={13}/> },
    comment_pin: { label: 'Pin',    icon: <MessageSquare size={13}/> },
  }

  // If no maps, show a landing screen
  if (maps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
        <style>{`
          .mm-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); padding: 8px 16px; border-radius: var(--radius-md); font-size: var(--text-sm); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.15s, border-color 0.15s; }
          .mm-btn:hover { background: var(--color-surface-offset); border-color: var(--color-primary); }
          .mm-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
          .mm-btn.primary:hover { background: var(--color-primary-hover); }
          .mm-btn.danger { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #ef4444; }
          .mm-btn.danger:hover { background: rgba(239,68,68,0.25); }
          .mm-layer-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-md); cursor: pointer; transition: background 0.12s; }
          .mm-layer-row:hover { background: var(--color-surface-2); }
          .mm-layer-row.active { background: var(--color-primary-muted); border: 1px solid rgba(30,69,252,0.3); }
          .mm-tool-btn { background: transparent; border: 1px solid transparent; color: var(--color-text-muted); padding: 5px 8px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all 0.12s; white-space: nowrap; }
          .mm-tool-btn:hover { background: var(--color-surface-2); color: var(--color-text-base); }
          .mm-tool-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
          .mm-panel { background: var(--color-surface-1); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
          .mm-panel-title { font-size: 10px; font-weight: var(--weight-bold); text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-faint); }
          .mm-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 6px 10px; font-size: var(--text-xs); width: 100%; box-sizing: border-box; }
          .mm-input:focus { outline: none; border-color: var(--color-primary); }
          .mm-select { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 6px 8px; font-size: var(--text-xs); cursor: pointer; width: 100%; }
          .mm-zone-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; }
          .mm-zone-row:hover { background: var(--color-surface-2); }
          .mm-zone-row.active { background: var(--color-secondary-muted); outline: 1px solid rgba(205,241,43,0.3); }
          .mm-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }
          .mm-tag { font-size: 9px; padding: 1px 6px; border-radius: 999px; background: var(--color-surface-offset); color: var(--color-text-muted); }
          .mm-cp-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); }
          .mm-canvas-area { position: relative; overflow: hidden; flex: 1; min-height: 0; background: #0b0c10; cursor: crosshair; }
          .mm-canvas-stack { position: absolute; transform-origin: top left; }
          .mm-canvas-stack canvas { position: absolute; top: 0; left: 0; }
          .mm-map-tab { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-muted); padding: 4px 12px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; font-size: 11px; cursor: pointer; transition: all 0.12s; }
          .mm-map-tab.active { background: var(--color-surface-1); color: var(--color-text-base); border-bottom-color: var(--color-surface-1); }
          .mm-separator { height: 1px; background: var(--color-surface-offset); margin: 4px 0; }
          .mm-kv-row { display: flex; gap: 4px; align-items: center; }
          .mm-kv-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 4px 6px; font-size: 11px; flex: 1; }
          .mm-kv-input:focus { outline: none; border-color: var(--color-primary); }
        `}</style>
        <div style={{ textAlign: 'center' }}>
          <Map size={48} style={{ color: 'var(--color-primary)', marginBottom: 16 }} />
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', margin: '0 0 8px' }}>Concept Map Designer</h2>
          <p style={{ fontSize: 'var(--text-sm)', maxWidth: 400 }}>2D pre-production level design canvas. Paint zones, sketch layouts, and export structured JSON for Unity, Godot, or Unreal.</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="mm-btn primary" onClick={() => setShowNewMapWizard(true)}><Plus size={14}/> New Map</button>
          <button className="mm-btn" onClick={loadJSON}><Upload size={14}/> Open JSON</button>
        </div>
        {showNewMapWizard && (
          <NewMapWizard
            name={wizardName} setName={setWizardName}
            grid={wizardGrid} setGrid={setWizardGrid}
            cellSize={wizardCellSize} setCellSize={setWizardCellSize}
            w={wizardW} setW={setWizardW}
            h={wizardH} setH={setWizardH}
            scale={wizardScale} setScale={setWizardScale}
            realistic={wizardRealistic} setRealistic={setWizardRealistic}
            biome={wizardBiome} setBiome={setWizardBiome}
            octaves={wizardOctaves} setOctaves={setWizardOctaves}
            roughness={wizardRoughness} setRoughness={setWizardRoughness}
            onCreate={createMap}
            onClose={() => setShowNewMapWizard(false)}
          />
        )}
      </div>
    )
  }

  // Main editor UI
  const validTools = LAYER_TOOLS[activeLayerType]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0, overflow: 'hidden' }}>
      <style>{`
        .mm-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); padding: 6px 12px; border-radius: var(--radius-md); font-size: var(--text-xs); cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.15s, border-color 0.15s; flex-shrink: 0; }
        .mm-btn:hover { background: var(--color-surface-offset); border-color: var(--color-primary); }
        .mm-btn.primary { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
        .mm-btn.primary:hover { background: var(--color-primary-hover); }
        .mm-btn.danger { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.4); color: #ef4444; }
        .mm-btn.danger:hover { background: rgba(239,68,68,0.25); }
        .mm-layer-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; }
        .mm-layer-row:hover { background: var(--color-surface-2); }
        .mm-layer-row.active { background: var(--color-primary-muted); border: 1px solid rgba(30,69,252,0.3); }
        .mm-tool-btn { background: transparent; border: 1px solid transparent; color: var(--color-text-muted); padding: 5px 8px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: all 0.12s; white-space: nowrap; }
        .mm-tool-btn:hover { background: var(--color-surface-2); color: var(--color-text-base); }
        .mm-tool-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
        .mm-panel { background: var(--color-surface-1); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-lg); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
        .mm-panel-title { font-size: 10px; font-weight: var(--weight-bold); text-transform: uppercase; letter-spacing: 0.07em; color: var(--color-text-faint); }
        .mm-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 5px 8px; font-size: var(--text-xs); width: 100%; box-sizing: border-box; }
        .mm-input:focus { outline: none; border-color: var(--color-primary); }
        .mm-select { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 5px 8px; font-size: var(--text-xs); cursor: pointer; width: 100%; }
        .mm-zone-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s; user-select: none; }
        .mm-zone-row:hover { background: var(--color-surface-2); }
        .mm-zone-row.active { background: var(--color-secondary-muted); outline: 1px solid rgba(205,241,43,0.3); }
        .mm-swatch { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15); }
        .mm-tag { font-size: 9px; padding: 1px 5px; border-radius: 999px; background: var(--color-surface-offset); color: var(--color-text-muted); }
        .mm-cp-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: var(--radius-sm); background: var(--color-surface-2); }
        .mm-canvas-area { position: relative; overflow: hidden; flex: 1; min-height: 0; background: repeating-conic-gradient(#1b1f30 0% 25%, #131622 0% 50%) 0 0 / 16px 16px; cursor: crosshair; user-select: none; }
        .mm-canvas-stack { position: absolute; transform-origin: top left; }
        .mm-canvas-stack canvas { position: absolute; top: 0; left: 0; }
        .mm-map-tab-container { display: flex; align-items: center; background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm) var(--radius-sm) 0 0; border-bottom: none; transition: all 0.12s; }
        .mm-map-tab-container.active { background: var(--color-surface-1); border-color: var(--color-surface-offset); border-bottom-color: var(--color-surface-1); }
        .mm-map-tab { background: transparent; border: none; color: var(--color-text-muted); padding: 4px 6px 4px 12px; font-size: 11px; cursor: pointer; transition: all 0.12s; }
        .mm-map-tab-container.active .mm-map-tab { color: var(--color-text-base); }
        .mm-map-tab-close { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px 8px 4px 4px; display: flex; align-items: center; border-radius: var(--radius-sm); transition: color 0.12s; }
        .mm-map-tab-close:hover { color: #E63946; }
        .mm-separator { height: 1px; background: var(--color-surface-offset); margin: 2px 0; }
        .mm-kv-row { display: flex; gap: 4px; align-items: center; }
        .mm-kv-input { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); color: var(--color-text-base); border-radius: var(--radius-sm); padding: 3px 6px; font-size: 11px; flex: 1; min-width: 0; }
        .mm-kv-input:focus { outline: none; border-color: var(--color-primary); }
        .mm-obj-type-btn { background: var(--color-surface-2); border: 1px solid var(--color-surface-offset); border-radius: var(--radius-sm); padding: 5px 8px; cursor: pointer; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--color-text-muted); transition: all 0.12s; }
        .mm-obj-type-btn:hover { background: var(--color-surface-offset); color: var(--color-text-base); }
        .mm-obj-type-btn.active { background: var(--color-secondary-muted); border-color: rgba(205,241,43,0.4); color: var(--color-secondary); }
        .mm-terrain-btn { background: var(--color-surface-2); border: 2px solid transparent; border-radius: var(--radius-sm); padding: 4px 8px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 5px; color: var(--color-text-muted); transition: all 0.12s; }
        .mm-terrain-btn.active { border-color: var(--color-secondary); color: var(--color-text-base); }
      `}</style>

      {/* Top control bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Zoom controls */}
        <button className="mm-btn" onClick={() => setZoom(z => Math.min(8, z * 1.2))} title="Zoom In"><ZoomIn size={13}/></button>
        <button className="mm-btn" onClick={() => setZoom(z => Math.max(0.1, z / 1.2))} title="Zoom Out"><ZoomOut size={13}/></button>
        <button className="mm-btn" onClick={() => { setZoom(1); setPanX(24); setPanY(24) }} title="Reset View"><Maximize size={13}/></button>
        <span style={{ fontSize: 10, color: 'var(--color-text-faint)', minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>

        <div style={{ width: 1, height: 20, background: 'var(--color-surface-offset)' }} />

        {/* Grid info */}
        {activeMap && (
          <>
            <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
              {activeMap.settings.gridType.toUpperCase()} · {activeMap.settings.cellSize}px · {activeMap.settings.scaleLabel}
            </span>
            <button
              className={`mm-btn ${snapEnabled ? 'primary' : ''}`}
              onClick={() => setSnapEnabled(s => !s)}
              title="Snap to Grid"
            >
              <Crosshair size={12}/> Snap
            </button>
          </>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--color-surface-offset)' }} />

        {/* Undo/Redo */}
        <button className="mm-btn" onClick={undo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }} title="Undo (Ctrl+Z)"><RotateCcw size={13}/></button>
        <button className="mm-btn" onClick={redo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }} title="Redo (Ctrl+Y)"><RotateCw size={13}/></button>

        <div style={{ flex: 1 }} />

        {/* File ops */}
        <button className="mm-btn" onClick={loadJSON} title="Open JSON"><Upload size={13}/> Open</button>
        <button className="mm-btn" onClick={exportJSON} title="Export JSON"><FileJson size={13}/> JSON</button>
        <button className="mm-btn" onClick={exportPNG} title="Export PNG"><Image size={13}/> PNG</button>
        <button className="mm-btn" onClick={() => setShowUnityModal(true)} title="Get Unity Importer"><Code size={13}/> Unity</button>
        <button className="mm-btn primary" onClick={() => setShowNewMapWizard(true)}><Plus size={13}/> New Map</button>
      </div>

      {/* Map page tabs */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 12px', background: 'var(--color-surface-1)', borderBottom: '1px solid var(--color-surface-offset)', flexShrink: 0, overflowX: 'auto' }}>
        {maps.map((m, i) => (
          <div
            key={m.settings.mapId}
            className={`mm-map-tab-container ${i === activeMapIdx ? 'active' : ''}`}
          >
            {renameMapIdx === i ? (
              <input
                className="mm-kv-input"
                style={{ width: 100, fontSize: 11, padding: '2px 4px', height: 20 }}
                value={renameInputName}
                onChange={e => setRenameInputName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenameMapIdx(null)
                }}
                autoFocus
              />
            ) : (
              <button
                className="mm-map-tab"
                title="Double click to rename"
                onClick={() => setActiveMapIdx(i)}
                onDoubleClick={() => {
                  setRenameMapIdx(i)
                  setRenameInputName(m.settings.name)
                }}
              >
                {m.settings.name}
              </button>
            )}
            <button
              className="mm-map-tab-close"
              title="Delete map from disk"
              onClick={async (e) => {
                e.stopPropagation()
                const confirmed = await confirm({
                  title: 'Delete map',
                  message: `Are you sure you want to permanently delete the map "${m.settings.name}" from disk?`,
                  confirmText: 'Delete Map',
                  isDestructive: true
                })
                if (!confirmed) return
                try {
                  await window.electronAPI.maps.deleteMap(m.settings.name)
                  setMaps(prev => {
                    const next = prev.filter((_, idx) => idx !== i)
                    if (activeMapIdx >= next.length) {
                      setActiveMapIdx(Math.max(0, next.length - 1))
                    }
                    return next
                  })
                } catch (err) {
                  console.error('Failed to delete map:', err)
                }
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Three-column editor body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: Tool panel */}
        <div style={{ width: 180, flexShrink: 0, background: 'var(--color-surface-1)', borderRight: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 8px', overflowY: 'auto' }}>
          {/* Layer selector */}
          <div className="mm-panel">
            <div className="mm-panel-title">Active Layer</div>
            {(['terrain','zones','objects','paths','annotations'] as LayerType[]).map(lt => (
              <button
                key={lt}
                className={`mm-layer-row ${activeLayerType === lt ? 'active' : ''}`}
                onClick={() => setActiveLayerType(lt)}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: activeLayerType === lt ? 'var(--color-text-base)' : 'var(--color-text-muted)' }}
              >
                <span style={{ textTransform: 'capitalize' }}>{lt}</span>
              </button>
            ))}
          </div>

          {/* Tools */}
          <div className="mm-panel">
            <div className="mm-panel-title">Tools</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {validTools.map(tid => (
                <button
                  key={tid}
                  className={`mm-tool-btn ${activeTool === tid ? 'active' : ''}`}
                  onClick={() => setActiveTool(tid)}
                  title={toolInfo[tid].label}
                >
                  {toolInfo[tid].icon}
                  <span>{toolInfo[tid].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Zone palette */}
          {activeLayerType === 'zones' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              <div className="mm-panel-title">Zone Palette</div>
              {zonePalette.map(zp => (
                <div
                  key={zp.id}
                  className={`mm-zone-row ${zp.id === activeZonePaletteId ? 'active' : ''}`}
                  onClick={() => setActiveZonePaletteId(zp.id)}
                >
                  <div className="mm-swatch" style={{ background: zp.color }} />
                  <span style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-base)' }}>{zp.name}</span>
                </div>
              ))}
              <button className="mm-btn" style={{ width: '100%', justifyContent: 'center', marginTop: 4, fontSize: 11 }}
                onClick={() => {
                  const newEntry: ZonePaletteEntry = { id: genId('zp'), type: 'custom', name: 'New Zone', color: '#8338EC', defaultProperties: {} }
                  setZonePalette(prev => [...prev, newEntry])
                  setActiveZonePaletteId(newEntry.id)
                }}>
                <Plus size={11}/> Add Zone
              </button>
            </div>
          )}

          {/* Terrain types */}
          {activeLayerType === 'terrain' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              {activeMap?.settings.realisticMode ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="mm-panel-title">Realistic Painting</div>
                  
                  {/* Brush Size */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)' }}>
                      <span>Brush Size</span>
                      <span>{realisticBrushSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={300}
                      step={5}
                      value={realisticBrushSize}
                      onChange={e => setRealisticBrushSize(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                    />
                  </div>

                  {/* Eraser / Paint mode */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className={`mm-btn ${!realisticEraser ? 'primary' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                      onClick={() => setRealisticEraser(false)}
                    >
                      🖌️ Draw
                    </button>
                    <button
                      className={`mm-btn ${realisticEraser ? 'primary' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
                      onClick={() => setRealisticEraser(true)}
                    >
                      🧽 Erase (Ocean)
                    </button>
                  </div>

                  {/* Colors */}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: -4 }}>Palette</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, maxHeight: '280px', overflowY: 'auto', paddingRight: 4 }}>
                    {REALISTIC_PAINT_COLORS.map(c => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setRealisticPaintColor(c.id)
                          setRealisticEraser(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 8px',
                          background: realisticPaintColor === c.id && !realisticEraser ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
                          border: `1.5px solid ${realisticPaintColor === c.id && !realisticEraser ? 'var(--color-primary)' : 'transparent'}`,
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.12s'
                        }}
                      >
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="mm-panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Terrain Type</span>
                    <button
                      className="mm-action-btn-mini"
                      style={{ background: 'none', border: 'none', color: '#00B4D8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, padding: 0 }}
                      onClick={() => {
                        setNewTerrainName('')
                        setNewTerrainColor('#8338EC')
                        setShowAddCustomTerrainModal(true)
                      }}
                    >
                      <Plus size={11}/> Add Custom
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: '250px', overflowY: 'auto' }}>
                    {TERRAIN_TYPES.map(t => (
                      <button
                        key={t}
                        className={`mm-terrain-btn ${activeTerrainType === t ? 'active' : ''}`}
                        onClick={() => setActiveTerrainType(t)}
                      >
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: TERRAIN_COLORS[t], flexShrink: 0 }} />
                        <span style={{ textTransform: 'capitalize' }}>{t}</span>
                      </button>
                    ))}
                    {(activeMap?.settings.customTerrains || []).map(ct => (
                      <div key={ct.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <button
                          className={`mm-terrain-btn ${activeTerrainType === ct.id ? 'active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() => setActiveTerrainType(ct.id)}
                        >
                          <div style={{ width: 12, height: 12, borderRadius: 2, background: ct.color, flexShrink: 0 }} />
                          <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.name}</span>
                        </button>
                        <button
                          title="Delete custom terrain"
                          style={{ background: 'none', border: 'none', color: '#E63946', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const confirmed = await confirm({
                              title: 'Delete terrain type',
                              message: `Delete custom terrain type "${ct.name}"?`,
                              confirmText: 'Delete',
                              isDestructive: true
                            })
                            if (!confirmed) return
                            if (activeTerrainType === ct.id) setActiveTerrainType('grass')
                            setActiveMap(s => ({
                              ...s,
                              settings: {
                                ...s.settings,
                                customTerrains: (s.settings.customTerrains || []).filter(c => c.id !== ct.id)
                              },
                              terrain: s.terrain.filter(cell => cell.type !== ct.id && cell.type !== ct.name)
                            }))
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Object types */}
          {activeLayerType === 'objects' && (
            <div className="mm-panel" style={{ flex: 1 }}>
              <div className="mm-panel-title">Object Type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {OBJECT_TYPES.map(ot => (
                  <button
                    key={ot.id}
                    className={`mm-obj-type-btn ${activeObjectType === ot.id ? 'active' : ''}`}
                    onClick={() => setActiveObjectType(ot.id)}
                  >
                    <span style={{ fontSize: 16 }}>{ot.icon}</span>
                    <span style={{ fontSize: 9 }}>{ot.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: Canvas */}
        <div
          className="mm-canvas-area"
          ref={containerRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={(e) => {
            onMouseUp(e)
            setHoverCoord(null)
          }}
          style={{ cursor: activeTool === 'comment_pin' ? 'cell' : activeTool === 'select' ? 'default' : activeTool === 'eraser' ? 'crosshair' : 'crosshair' }}
        >
          <div
            className="mm-canvas-stack"
            style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, width: canvasW, height: canvasH }}
          >
            {/* Map border */}
            <div style={{ position: 'absolute', inset: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 100 }} />

            <canvas ref={bgCanvasRef}     width={canvasW} height={canvasH} style={{ zIndex: 1 }} />
            <canvas ref={terrainCanvasRef}width={canvasW} height={canvasH} style={{ zIndex: 2 }} />
            <canvas ref={vectorCanvasRef} width={canvasW} height={canvasH} style={{ zIndex: 3 }} />
            <canvas ref={previewCanvasRef}width={canvasW} height={canvasH} style={{ zIndex: 4, pointerEvents: 'none' }} />
            <canvas ref={gridCanvasRef}   width={canvasW} height={canvasH} style={{ zIndex: 5, pointerEvents: 'none', opacity: 0.6 }} />
          </div>

          {/* Premium Status Overlay */}
          {activeMap && (
            <div style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              background: 'rgba(13,16,34,0.85)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 10,
              color: 'var(--color-text-muted)',
              pointerEvents: 'none',
              zIndex: 10,
              fontFamily: 'monospace'
            }}>
              <span>SIZE: {activeMap.settings.w}x{activeMap.settings.h}px</span>
              <span style={{ width: 1, height: 10, background: 'var(--color-surface-offset)' }} />
              <span>MODE: {activeMap.settings.realisticMode ? 'Realistic' : 'Grid'}</span>
              <span style={{ width: 1, height: 10, background: 'var(--color-surface-offset)' }} />
              <span>X: {hoverCoord ? hoverCoord[0] : 0}  Y: {hoverCoord ? hoverCoord[1] : 0}</span>
            </div>
          )}

          {/* Polygon hint */}
          {activeTool === 'polygon' && activeLayerType === 'zones' && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,16,34,0.9)', border: '1px solid var(--color-surface-offset)', borderRadius: 999, padding: '4px 12px', fontSize: 11, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
              Click to add vertices · Double-click to close polygon · Esc to cancel
            </div>
          )}
          {activeTool === 'pen' && activeLayerType === 'paths' && (
            <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,16,34,0.9)', border: '1px solid var(--color-surface-offset)', borderRadius: 999, padding: '4px 12px', fontSize: 11, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
              Click to add waypoints · Double-click to finish path · Esc to cancel
            </div>
          )}
        </div>

        {/* Right: Layers + Inspector */}
        <div style={{ width: 220, flexShrink: 0, background: 'var(--color-surface-1)', borderLeft: '1px solid var(--color-surface-offset)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 8px', overflowY: 'auto' }}>

          {/* Layers stack */}
          <div className="mm-panel">
            <div className="mm-panel-title">Layers</div>
            {activeMap?.layers.slice().reverse().map(layer => (
              <div key={layer.id} className="mm-layer-row" style={{ border: '1px solid transparent', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px' }}>
                <button
                  onClick={() => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: layer.visible ? 'var(--color-secondary)' : 'var(--color-text-faint)', padding: 0, display: 'flex' }}
                  title={layer.visible ? 'Hide' : 'Show'}
                >
                  {layer.visible ? <Eye size={12}/> : <EyeOff size={12}/>}
                </button>
                <button
                  onClick={() => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, locked: !l.locked } : l) }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: layer.locked ? 'var(--color-warning)' : 'var(--color-text-faint)', padding: 0, display: 'flex' }}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                >
                  {layer.locked ? <Lock size={11}/> : <Unlock size={11}/>}
                </button>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--color-text-base)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {layer.name}
                </span>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={layer.opacity}
                  onChange={e => setActiveMap(s => ({ ...s, layers: s.layers.map(l => l.id === layer.id ? { ...l, opacity: Number(e.target.value) } : l) }))}
                  style={{ width: 40, cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                  title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                />
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', minWidth: 24, textAlign: 'right' }}>
                  {Math.round(layer.opacity * 100)}%
                </span>
              </div>
            ))}
          </div>

          {/* Inspector */}
          <div className="mm-panel" style={{ flex: 1 }}>
            <div className="mm-panel-title">Inspector</div>
            {selectedZone && (
              <ZoneInspector
                key={inspectorKey + selectedZone.id}
                zone={selectedZone}
                onChange={z => setActiveMap(s => ({ ...s, zones: s.zones.map(zz => zz.id === z.id ? z : zz) }))}
                onDelete={() => deleteZone(selectedZone.id)}
                zonePalette={zonePalette}
              />
            )}
            {selectedObject && !selectedZone && (
              <ObjectInspector
                key={inspectorKey + selectedObject.id}
                obj={selectedObject}
                onChange={o => setActiveMap(s => ({ ...s, objects: s.objects.map(oo => oo.id === o.id ? o : oo) }))}
                onDelete={() => deleteObject(selectedObject.id)}
              />
            )}
            {selectedPath && !selectedZone && !selectedObject && (
              <PathInspector
                key={inspectorKey + selectedPath.id}
                path={selectedPath}
                onChange={p => setActiveMap(s => ({ ...s, paths: s.paths.map(pp => pp.id === p.id ? p : pp) }))}
                onDelete={() => deletePath(selectedPath.id)}
              />
            )}
            {selectedComment && !selectedZone && !selectedObject && !selectedPath && (
              <CommentInspector
                key={inspectorKey + selectedComment.id}
                comment={selectedComment}
                onChange={c => setActiveMap(s => ({ ...s, comments: s.comments.map(cc => cc.id === c.id ? c : cc) }))}
                onDelete={() => deleteComment(selectedComment.id)}
              />
            )}
            {!selectedZone && !selectedObject && !selectedPath && !selectedComment && (
              <div style={{ color: 'var(--color-text-faint)', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
                Select an element to inspect
              </div>
            )}
          </div>

          {/* Version checkpoints */}
          <div className="mm-panel">
            <div className="mm-panel-title">Checkpoints</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                className="mm-input"
                placeholder="Label…"
                value={checkpointLabel}
                onChange={e => setCheckpointLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveCheckpoint()}
                style={{ flex: 1 }}
              />
              <button className="mm-btn primary" onClick={saveCheckpoint} title="Save Checkpoint" style={{ padding: '5px 8px' }}>
                <Check size={12}/>
              </button>
            </div>
            {checkpoints.slice().reverse().map(cp => (
              <div key={cp.id} className="mm-cp-row">
                <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-base)' }}>{cp.label}</span>
                <span style={{ fontSize: 9, color: 'var(--color-text-faint)' }}>{new Date(cp.timestamp).toLocaleTimeString()}</span>
                <button
                  onClick={() => restoreCheckpoint(cp)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', padding: 0, display: 'flex' }}
                  title="Restore"
                >
                  <RefreshCw size={11}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showNewMapWizard && (
        <NewMapWizard
          name={wizardName} setName={setWizardName}
          grid={wizardGrid} setGrid={setWizardGrid}
          cellSize={wizardCellSize} setCellSize={setWizardCellSize}
          w={wizardW} setW={setWizardW}
          h={wizardH} setH={setWizardH}
          scale={wizardScale} setScale={setWizardScale}
          realistic={wizardRealistic} setRealistic={setWizardRealistic}
          biome={wizardBiome} setBiome={setWizardBiome}
          octaves={wizardOctaves} setOctaves={setWizardOctaves}
          roughness={wizardRoughness} setRoughness={setWizardRoughness}
          onCreate={createMap}
          onClose={() => setShowNewMapWizard(false)}
        />
      )}

      {showAddCustomTerrainModal && (
        <Modal title="Add Custom Terrain" onClose={() => setShowAddCustomTerrainModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FieldRow label="Terrain Name">
              <input
                className="mm-input"
                value={newTerrainName}
                onChange={e => setNewTerrainName(e.target.value)}
                placeholder="Desert, Ice, Mud, etc."
                autoFocus
              />
            </FieldRow>
            <FieldRow label="Terrain Color">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={newTerrainColor}
                  onChange={e => setNewTerrainColor(e.target.value)}
                  style={{ width: 40, height: 30, border: '1px solid var(--color-surface-offset)', padding: 0, background: 'none', cursor: 'pointer', borderRadius: 4 }}
                />
                <input
                  className="mm-input"
                  style={{ flex: 1 }}
                  value={newTerrainColor}
                  onChange={e => setNewTerrainColor(e.target.value)}
                  placeholder="#8338EC"
                />
              </div>
            </FieldRow>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="mm-btn" onClick={() => setShowAddCustomTerrainModal(false)}>Cancel</button>
              <button
                className="mm-btn primary"
                onClick={() => {
                  const name = newTerrainName.trim()
                  const color = newTerrainColor.trim()
                  if (!name || !color) return
                  const newId = genId('ct')
                  setActiveMap(s => {
                    const list = s.settings.customTerrains || []
                    if (list.some(c => c.name.toLowerCase() === name.toLowerCase()) || TERRAIN_TYPES.includes(name.toLowerCase())) {
                      toast('Terrain type already exists', { type: 'warning' })
                      return s
                    }
                    const updatedSettings = {
                      ...s.settings,
                      customTerrains: [...list, { id: newId, name, color }]
                    }
                    return {
                      ...s,
                      settings: updatedSettings
                    }
                  })
                  setActiveTerrainType(newId)
                  setShowAddCustomTerrainModal(false)
                }}
              >
                Add Terrain
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showCommentModal && (
        <Modal title="Add Comment" onClose={() => setShowCommentModal(null)}>
          <textarea
            className="mm-input"
            rows={3}
            placeholder="Design note…"
            value={commentDraft}
            onChange={e => setCommentDraft(e.target.value)}
            style={{ resize: 'vertical' }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="mm-btn" onClick={() => { setShowCommentModal(null); setCommentDraft('') }}>Cancel</button>
            <button className="mm-btn primary" onClick={() => {
              if (!showCommentModal || !commentDraft.trim()) return
              pushUndo()
              setActiveMap(s => ({
                ...s,
                comments: [...s.comments, { id: genId('c'), text: commentDraft.trim(), x: showCommentModal.x, y: showCommentModal.y }]
              }))
              setCommentDraft('')
              setShowCommentModal(null)
            }}>Pin Note</button>
          </div>
        </Modal>
      )}

      {showUnityModal && (
        <Modal title="Unity Import Script" onClose={() => setShowUnityModal(false)} wide>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            Copy this C# script into your Unity project's <code>Assets/</code> folder. Open it from <strong>Window → Map Maker → Import Map JSON</strong>.
          </p>
          <pre style={{
            background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)',
            padding: 12, fontSize: 10, overflowX: 'auto', maxHeight: 360,
            color: 'var(--color-text-muted)', lineHeight: 1.5,
            border: '1px solid var(--color-surface-offset)'
          }}>
            {generateUnityScript()}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="mm-btn primary" onClick={() => navigator.clipboard.writeText(generateUnityScript())}>
              <Copy size={12}/> Copy to Clipboard
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Sub-components

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId()
  const containerRef = useFocusTrap(true)
  useEscapeKey(onClose, true)

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)', padding: 20,
        width: wide ? 720 : 400, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 12
      }}>
        <div className="row-between">
          <h3 id={titleId} style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', padding: 4 }}><X size={16}/></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function NewMapWizard({ name, setName, grid, setGrid, cellSize, setCellSize, w, setW, h, setH, scale, setScale, realistic, setRealistic, biome, setBiome, octaves, setOctaves, roughness, setRoughness, onCreate, onClose }:
  { name:string; setName:(v:string)=>void; grid:GridType; setGrid:(v:GridType)=>void; cellSize:number; setCellSize:(v:number)=>void; w:number; setW:(v:number)=>void; h:number; setH:(v:number)=>void; scale:string; setScale:(v:string)=>void; realistic:boolean; setRealistic:(v:boolean)=>void; biome:string; setBiome:(v:string)=>void; octaves:number; setOctaves:(v:number)=>void; roughness:number; setRoughness:(v:number)=>void; onCreate:()=>void; onClose:()=>void }) {
  return (
    <Modal title="New Map" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FieldRow label="Map Name">
          <input className="mm-input" value={name} onChange={e => setName(e.target.value)} placeholder="Untitled Map" />
        </FieldRow>
        <FieldRow label="Grid Type">
          <select className="mm-select" value={grid} onChange={e => setGrid(e.target.value as GridType)}>
            <option value="square">Square</option>
            <option value="hex">Hex (Flat-top, Axial)</option>
            <option value="isometric">Isometric</option>
          </select>
        </FieldRow>
        <FieldRow label={grid === 'hex' ? 'Hex Radius (px)' : 'Cell Size (px)'}>
          <input className="mm-input" type="number" min={8} max={256} value={cellSize} onChange={e => setCellSize(Number(e.target.value))} />
        </FieldRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FieldRow label="Width (px)">
            <input className="mm-input" type="number" min={400} max={8192} value={w} onChange={e => setW(Number(e.target.value))} />
          </FieldRow>
          <FieldRow label="Height (px)">
            <input className="mm-input" type="number" min={400} max={8192} value={h} onChange={e => setH(Number(e.target.value))} />
          </FieldRow>
        </div>
        <FieldRow label="Scale Label">
          <input className="mm-input" value={scale} onChange={e => setScale(e.target.value)} placeholder="1 cell = 1m" />
        </FieldRow>

        {/* Realistic Map Separator */}
        <div style={{ height: 1, background: 'var(--color-surface-offset)', margin: '2px 0' }} />

        {/* Realistic toggle */}
        <div
          onClick={() => setRealistic(!realistic)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: realistic ? 'rgba(90,158,75,0.12)' : 'var(--color-surface-2)',
            border: `1px solid ${realistic ? 'rgba(90,158,75,0.4)' : 'var(--color-surface-offset)'}`,
            borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.15s',
            userSelect: 'none'
          }}
        >
          <div style={{
            width: 34, height: 18, borderRadius: 9, flexShrink: 0,
            background: realistic ? '#5a9e4b' : 'var(--color-surface-offset)',
            position: 'relative', transition: 'background 0.2s'
          }}>
            <div style={{
              position: 'absolute', top: 2, left: realistic ? 18 : 2,
              width: 14, height: 14, borderRadius: 7,
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: realistic ? '#5a9e4b' : 'var(--color-text-base)' }}>
              🌍 Realistic Free-Paint Mode
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
              Bypass grid cells to freely paint smooth, organic geographic paths and biomes
            </div>
          </div>
        </div>

        {realistic && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px', background: 'rgba(90,158,75,0.06)', border: '1px solid rgba(90,158,75,0.2)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 11, color: '#5a9e4b', fontWeight: 600 }}>
              🌿 Gridless Painting Mode Enabled
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              The canvas will initialize as a deep ocean. You can use the brush in the sidebar to draw custom terrain colors (beaches, fields, highlands, snow peaks) with soft blending.
            </div>
          </div>
        )}

        <div style={{ padding: '8px 10px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--color-warning)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Grid type and canvas dimensions are locked after creation to prevent coordinate misalignment.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="mm-btn" onClick={onClose}>Cancel</button>
          <button className="mm-btn primary" onClick={onCreate}>
            {realistic ? '🌍' : <Plus size={13}/>} {realistic ? 'Generate & Create' : 'Create Map'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

function KVEditor({ properties, onChange }: { properties: Record<string,string>; onChange: (p: Record<string,string>) => void }) {
  const entries = Object.entries(properties)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="mm-kv-row">
          <input className="mm-kv-input" value={k} onChange={e => {
            const next = { ...properties }
            delete next[k]; next[e.target.value] = v; onChange(next)
          }} placeholder="key" />
          <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>:</span>
          <input className="mm-kv-input" value={v} onChange={e => onChange({ ...properties, [k]: e.target.value })} placeholder="value" />
          <button onClick={() => { const next = { ...properties }; delete next[k]; onChange(next) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', padding: 2, display: 'flex', flexShrink: 0 }}>
            <X size={10}/>
          </button>
        </div>
      ))}
      <button className="mm-btn" style={{ fontSize: 10, padding: '3px 8px' }}
        onClick={() => onChange({ ...properties, [`key_${Date.now()}`]: '' })}>
        <Plus size={10}/> Add Property
      </button>
    </div>
  )
}

function ZoneInspector({ zone, onChange, onDelete, zonePalette }:
  { zone: ZoneDef; onChange: (z: ZoneDef) => void; onDelete: () => void; zonePalette: ZonePaletteEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Name">
        <input className="mm-input" value={zone.name} onChange={e => onChange({ ...zone, name: e.target.value })} />
      </FieldRow>
      <FieldRow label="Type">
        <select className="mm-select" value={zone.type} onChange={e => {
          const match = zonePalette.find(p => p.type === e.target.value)
          onChange({ ...zone, type: e.target.value, color: match?.color || zone.color })
        }}>
          {zonePalette.map(p => <option key={p.id} value={p.type}>{p.name}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Color">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="mm-swatch" style={{ background: zone.color, width: 20, height: 20 }} />
          <input className="mm-input" value={zone.color} onChange={e => onChange({ ...zone, color: e.target.value })} style={{ flex: 1 }} />
        </div>
      </FieldRow>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={zone.properties} onChange={p => onChange({ ...zone, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Zone
      </button>
    </div>
  )
}

function ObjectInspector({ obj, onChange, onDelete }:
  { obj: MapObject; onChange: (o: MapObject) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Type">
        <select className="mm-select" value={obj.type} onChange={e => onChange({ ...obj, type: e.target.value })}>
          {OBJECT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </FieldRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <FieldRow label="X">
          <input className="mm-input" type="number" value={Math.round(obj.x)} onChange={e => onChange({ ...obj, x: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Y">
          <input className="mm-input" type="number" value={Math.round(obj.y)} onChange={e => onChange({ ...obj, y: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Rotation °">
          <input className="mm-input" type="number" min={0} max={359} value={Math.round(obj.rotation)} onChange={e => onChange({ ...obj, rotation: Number(e.target.value) })} />
        </FieldRow>
        <FieldRow label="Scale">
          <input className="mm-input" type="number" min={0.1} max={10} step={0.1} value={obj.scale.toFixed(2)} onChange={e => onChange({ ...obj, scale: Number(e.target.value) })} />
        </FieldRow>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={obj.properties} onChange={p => onChange({ ...obj, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Object
      </button>
    </div>
  )
}

function PathInspector({ path, onChange, onDelete }:
  { path: MapPath; onChange: (p: MapPath) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Type">
        <select className="mm-select" value={path.type} onChange={e => onChange({ ...path, type: e.target.value })}>
          {['patrol','road','river','border','camera_rail','custom'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </FieldRow>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>{path.points.length} waypoints</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
      <KVEditor properties={path.properties} onChange={p => onChange({ ...path, properties: p })} />
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Path
      </button>
    </div>
  )
}

function CommentInspector({ comment, onChange, onDelete }:
  { comment: MapComment; onChange: (c: MapComment) => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldRow label="Note">
        <textarea className="mm-input" rows={3} value={comment.text} onChange={e => onChange({ ...comment, text: e.target.value })} style={{ resize: 'vertical' }} />
      </FieldRow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <FieldRow label="X"><input className="mm-input" type="number" value={Math.round(comment.x)} onChange={e => onChange({ ...comment, x: Number(e.target.value) })} /></FieldRow>
        <FieldRow label="Y"><input className="mm-input" type="number" value={Math.round(comment.y)} onChange={e => onChange({ ...comment, y: Number(e.target.value) })} /></FieldRow>
      </div>
      <button className="mm-btn danger" style={{ justifyContent: 'center', marginTop: 4 }} onClick={onDelete}>
        <Trash2 size={11}/> Delete Note
      </button>
    </div>
  )
}
