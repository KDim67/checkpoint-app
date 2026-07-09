import React, { useState, useCallback, useMemo, useEffect, useId, useRef } from 'react'
import { Download, Layers, RefreshCw, Trash2, Plus, Copy, AlertTriangle, CheckCircle, GitFork, Palette, Info, Sparkles, Box, Settings, Loader, Repeat, Grid, Scissors, Sliders, Maximize2, Map } from 'lucide-react'
import MapMakerView from './MapMakerView'
import { useToast } from './ui/Toast'
import ColorPicker from './ui/ColorPicker'
import mermaid from 'mermaid'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'

class BinaryTreePacker {
  root: { x: number; y: number; w: number; h: number; used: boolean; right?: any; down?: any }

  constructor(w: number, h: number) {
    this.root = { x: 0, y: 0, w, h, used: false }
  }

  fit(w: number, h: number): { x: number; y: number } | null {
    const node = this.findNode(this.root, w, h)
    if (node) {
      return this.splitNode(node, w, h)
    }
    return null
  }

  findNode(node: any, w: number, h: number): any {
    if (node.used) {
      return this.findNode(node.right, w, h) || this.findNode(node.down, w, h)
    } else if (w <= node.w && h <= node.h) {
      return node
    }
    return null
  }

  splitNode(node: any, w: number, h: number): any {
    node.used = true
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h, used: false }
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h, used: false }
    return node
  }
}

// Shared PBR Pixel Processing Utility
interface PbrParams {
  normalIntensity: number
  heightDepth: number
  roughnessContrast: number
  roughnessBase: number
  aoIntensity: number
  /** Treat dark pixels as high instead of low (crevices vs. ridges). */
  invertHeight?: boolean
}

/**
 * Computes Height, Normal, Roughness and Ambient Occlusion map data from a source
 * RGBA pixel buffer using a Sobel-filter approach. Pure function, no canvas or DOM
 * dependencies, so it is safe to call from both the live-preview path and the
 * full-resolution export path without duplicating the loop.
 */
function computePbrMaps(src: Uint8ClampedArray, W: number, H: number, params: PbrParams) {
  const { normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight } = params

  // Luma-weighted grayscale with clamped border reads. Applying the height
  // inversion here keeps height, normal direction, roughness and AO coherent.
  const getGray = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(W - 1, x))
    const cy = Math.max(0, Math.min(H - 1, y))
    const i = (cy * W + cx) * 4
    const g = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255
    return invertHeight ? 1 - g : g
  }

  const len = W * H * 4
  const hData = new Uint8ClampedArray(len)
  const nData = new Uint8ClampedArray(len)
  const rData = new Uint8ClampedArray(len)
  const aData = new Uint8ClampedArray(len)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4

      // Height (luminance)
      const h = getGray(x, y)
      const hByte = Math.round(h * 255)
      hData[i] = hByte; hData[i + 1] = hByte; hData[i + 2] = hByte; hData[i + 3] = 255

      // Sobel 3×3 gradient
      const h00 = getGray(x - 1, y - 1); const h10 = getGray(x, y - 1); const h20 = getGray(x + 1, y - 1)
      const h01 = getGray(x - 1, y);                                      const h21 = getGray(x + 1, y)
      const h02 = getGray(x - 1, y + 1); const h12 = getGray(x, y + 1); const h22 = getGray(x + 1, y + 1)
      const dX = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02)
      const dY = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20)

      // Normal (Sobel → unit vector → packed [0-1])
      const nx = -dX * normalIntensity
      const ny = -dY * normalIntensity
      const nz = 1.0 / heightDepth
      const mag = Math.sqrt(nx * nx + ny * ny + nz * nz)
      nData[i]     = Math.round(((nx / mag) * 0.5 + 0.5) * 255)
      nData[i + 1] = Math.round(((ny / mag) * 0.5 + 0.5) * 255)
      nData[i + 2] = Math.round(((nz / mag) * 0.5 + 0.5) * 255)
      nData[i + 3] = 255

      // Roughness (contrast + bias on luminance)
      const rByte = Math.round(Math.max(0, Math.min(1, (h - 0.5) * roughnessContrast + 0.5 + (roughnessBase - 0.5))) * 255)
      rData[i] = rByte; rData[i + 1] = rByte; rData[i + 2] = rByte; rData[i + 3] = 255

      // Ambient Occlusion (gradient magnitude × height)
      const gradMag = Math.sqrt(dX * dX + dY * dY)
      const aoByte = Math.round(Math.max(0, Math.min(1, (1 - gradMag * aoIntensity) * (0.3 + 0.7 * h))) * 255)
      aData[i] = aoByte; aData[i + 1] = aoByte; aData[i + 2] = aoByte; aData[i + 3] = 255
    }
  }

  return { hData, nData, rData, aData }
}

// Pixel-art scaling cores (EPX / AdvMAME family)
// Pure functions over raw RGBA buffers, shared by the live preview and the
// export path, and composable (Scale4x = Scale2x applied twice).

/** Read a pixel as a packed 32-bit RGBA value with clamped border reads. */
function makePixelReaders(s: Uint8ClampedArray, w: number, h: number) {
  const idx = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y
    return (cy * w + cx) * 4
  }
  const pix = (x: number, y: number): number => {
    const i = idx(x, y)
    return ((s[i] << 24) | (s[i + 1] << 16) | (s[i + 2] << 8) | s[i + 3]) >>> 0
  }
  return { idx, pix }
}

/** Scale2x (EPX): doubles dimensions, preserving hard pixel-art edges. */
function scale2xData(s: Uint8ClampedArray, w: number, h: number) {
  const { idx, pix } = makePixelReaders(s, w, h)
  const out = new Uint8ClampedArray(w * 2 * h * 2 * 4)
  const put = (dx: number, dy: number, si: number) => {
    const di = (dy * w * 2 + dx) * 4
    out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const A = pix(x, y - 1)
      const C = pix(x - 1, y)
      const B = pix(x + 1, y)
      const D = pix(x, y + 1)
      const self = idx(x, y)
      put(x * 2,     y * 2,     (C === A && C !== D && A !== B) ? idx(x, y - 1) : self)
      put(x * 2 + 1, y * 2,     (A === B && A !== C && B !== D) ? idx(x + 1, y) : self)
      put(x * 2,     y * 2 + 1, (D === C && D !== B && C !== A) ? idx(x - 1, y) : self)
      put(x * 2 + 1, y * 2 + 1, (B === D && B !== A && D !== C) ? idx(x + 1, y) : self)
    }
  }
  return out
}

/** Scale3x (AdvMAME3x): triples dimensions with the 9-subpixel rule set. */
function scale3xData(s: Uint8ClampedArray, w: number, h: number) {
  const { idx, pix } = makePixelReaders(s, w, h)
  const out = new Uint8ClampedArray(w * 3 * h * 3 * 4)
  const put = (dx: number, dy: number, si: number) => {
    const di = (dy * w * 3 + dx) * 4
    out[di] = s[si]; out[di + 1] = s[si + 1]; out[di + 2] = s[si + 2]; out[di + 3] = s[si + 3]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const E = pix(x, y)
      const A = pix(x - 1, y - 1)
      const B = pix(x, y - 1)
      const C = pix(x + 1, y - 1)
      const D = pix(x - 1, y)
      const F = pix(x + 1, y)
      const G = pix(x - 1, y + 1)
      const H = pix(x, y + 1)
      const I = pix(x + 1, y + 1)
      const self = idx(x, y)
      const e1 = (D === B && D !== H && B !== F) ? idx(x - 1, y) : self
      const e2 = ((D === B && D !== H && B !== F && E !== C) || (B === F && B !== D && F !== H && E !== A)) ? idx(x, y - 1) : self
      const e3 = (B === F && B !== D && F !== H) ? idx(x + 1, y) : self
      const e4 = ((D === B && D !== H && B !== F && E !== G) || (D === H && D !== B && H !== F && E !== A)) ? idx(x - 1, y) : self
      const e6 = ((B === F && B !== D && F !== H && E !== I) || (H === F && H !== D && F !== B && E !== C)) ? idx(x + 1, y) : self
      const e7 = (D === H && D !== B && H !== F) ? idx(x - 1, y) : self
      const e8 = ((D === H && D !== B && H !== F && E !== I) || (H === F && H !== D && F !== B && E !== G)) ? idx(x, y + 1) : self
      const e9 = (H === F && H !== D && F !== B) ? idx(x + 1, y) : self
      put(x * 3,     y * 3,     e1)
      put(x * 3 + 1, y * 3,     e2)
      put(x * 3 + 2, y * 3,     e3)
      put(x * 3,     y * 3 + 1, e4)
      put(x * 3 + 1, y * 3 + 1, self)
      put(x * 3 + 2, y * 3 + 1, e6)
      put(x * 3,     y * 3 + 2, e7)
      put(x * 3 + 1, y * 3 + 2, e8)
      put(x * 3 + 2, y * 3 + 2, e9)
    }
  }
  return out
}

// Shared LUT Builder Utility
interface LutParams {
  exposure: number
  brightness: number
  contrast: number
  saturation: number
  temperature: number
}

/**
 * Builds a standard neutral 256×16 3D-LUT slice-strip as a flat Uint8ClampedArray.
 * A single source of truth consumed by both the live preview renderer and the export
 * path, keeping both pixel-perfect identical with no code duplication.
 */
function buildLutData(params: LutParams) {
  const { exposure, brightness, contrast, saturation, temperature } = params
  const expScale = Math.pow(2, exposure / 100)
  const contrastFactor = (100 + contrast) / 100
  const satFactor = (100 + saturation) / 100
  const tempShift = (temperature / 100) * 20
  const brightVal = (brightness / 100) * 255

  const d = new Uint8ClampedArray(256 * 16 * 4)

  for (let b = 0; b < 16; b++) {
    const blockX = b * 16
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let cr = (x / 15) * 255
        let cg = (y / 15) * 255
        let cb = (b / 15) * 255

        cr *= expScale; cg *= expScale; cb *= expScale
        cr += brightVal; cg += brightVal; cb += brightVal
        cr = (cr - 127.5) * contrastFactor + 127.5
        cg = (cg - 127.5) * contrastFactor + 127.5
        cb = (cb - 127.5) * contrastFactor + 127.5
        cr += tempShift; cb -= tempShift
        const luma = 0.299 * cr + 0.587 * cg + 0.114 * cb
        cr = luma + (cr - luma) * satFactor
        cg = luma + (cg - luma) * satFactor
        cb = luma + (cb - luma) * satFactor

        const idx = (y * 256 + (blockX + x)) * 4
        d[idx]     = Math.max(0, Math.min(255, Math.round(cr)))
        d[idx + 1] = Math.max(0, Math.min(255, Math.round(cg)))
        d[idx + 2] = Math.max(0, Math.min(255, Math.round(cb)))
        d[idx + 3] = 255
      }
    }
  }

  return d
}

// Interfaces

interface AssetFile {
  name: string
  path: string
  status: 'pending' | 'success' | 'error'
  error?: string
}

interface DialogueNode {
  id: string
  speaker: string
  text: string
  choices: Array<{ text: string; nextId: string }>
}

// Constants

const PALETTE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

// Helper to convert hex to RGB float (0.0 to 1.0)
const hexToRgbFloat = (hex: string) => {
  let c = hex.substring(1)
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2]
  }
  const r = parseInt(c.substring(0, 2), 16) / 255
  const g = parseInt(c.substring(2, 4), 16) / 255
  const b = parseInt(c.substring(4, 6), 16) / 255
  return { r: parseFloat(r.toFixed(3)), g: parseFloat(g.toFixed(3)), b: parseFloat(b.toFixed(3)) }
}

// Initialize Mermaid for local dark theme diagram rendering
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      background: '#131622',
      primaryColor: '#1e45fc',
      secondaryColor: '#cdf12b',
      lineColor: '#535e85',
      textColor: '#f1f5f9'
    }
  })
} catch (err) {
  console.error('Failed to initialize mermaid:', err)
}

// Inline Mermaid chart renderer component
function MermaidChart({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  useEffect(() => {
    let isMounted = true
    setError(null)

    const renderChart = async () => {
      try {
        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (isMounted) {
          setSvg(renderedSvg)
        }
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (isMounted) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setError(errMsg || 'Failed to render Mermaid chart')
        }
      }
    }

    renderChart()
    return () => {
      isMounted = false
    }
  }, [code, elementId])

  if (error) {
    return (
      <pre style={{
        color: 'var(--color-error)',
        background: 'var(--color-error-muted)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap'
      }}>
        {error}
      </pre>
    )
  }

  if (!svg) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-surface-2)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-surface-offset)',
        overflowX: 'auto',
        maxHeight: '340px',
        boxSizing: 'border-box'
      }}
    />
  )
}

export default function GameDevView() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<'renamer' | 'dialogue' | 'palette' | 'pbr' | 'seamless' | 'atlas' | 'slicer' | 'lut' | 'upscaler' | 'mapmaker'>('pbr')

  // Tab 1: Batch Asset Renamer State
  const [files, setFiles] = useState<AssetFile[]>([])
  const [renamerPreset, setRenamerPreset] = useState<'none' | 'texture' | 'mesh' | 'audio'>('none')

  // Tab 5: PBR Map Generator State
  const preloadTexturePath = useAppStore(state => state.gamedevPreloadTexturePath)
  const preloadCardId = useAppStore(state => state.gamedevSourceCardId)

  const [albedoPath, setAlbedoPath] = useState<string | null>(null)
  const [albedoUrl, setAlbedoUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [exportedFiles, setExportedFiles] = useState<string[]>([])
  const [shape, setShape] = useState<'sphere' | 'cube' | 'plane'>('sphere')
  const [rotate, setRotate] = useState(true)

  // Sliders
  const [normalIntensity, setNormalIntensity] = useState(2.5)
  const [heightDepth, setHeightDepth] = useState(1.0)
  const [roughnessContrast, setRoughnessContrast] = useState(1.0)
  const [roughnessBase, setRoughnessBase] = useState(0.5)
  const [aoIntensity, setAoIntensity] = useState(1.0)
  const [invertHeight, setInvertHeight] = useState(false)

  // Canvases
  const albedoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const heightCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const roughnessCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const aoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Image Ref
  const originalImageRef = useRef<HTMLImageElement | null>(null)

  // Tab 6: Seamless Texture Generator State
  const preloadSeamlessPath = useAppStore(state => state.gamedevPreloadSeamlessPath)
  const preloadSeamlessCardId = useAppStore(state => state.gamedevSourceSeamlessCardId)

  const [seamlessPath, setSeamlessPath] = useState<string | null>(null)
  const [seamlessUrl, setSeamlessUrl] = useState<string | null>(null)
  const [seamlessBlendWidth, setSeamlessBlendWidth] = useState(0.15) // Overlap fraction: 15%
  const [seamlessAlgorithm, setSeamlessAlgorithm] = useState<'mirror' | 'feather'>('feather')
  const [seamlessTilingScale, setSeamlessTilingScale] = useState(3) // 3x3 repetition default
  const [seamlessEqualizer, setSeamlessEqualizer] = useState(0.5) // Brightness Equalizer (High-Pass)
  const [seamlessWavySeams, setSeamlessWavySeams] = useState(0.5) // Seam warping amount
  const [isSeamlessProcessing, setIsSeamlessProcessing] = useState(false)
  const [isSeamlessSaving, setIsSeamlessSaving] = useState(false)
  const [seamlessShowGrid, setSeamlessShowGrid] = useState(false) // Toggle to show tiling boundaries
  const [seamlessExportedFile, setSeamlessExportedFile] = useState<string | null>(null)
  // Before/after compare: 'result' = show seamless output, 'original' = tile the raw source
  const [seamlessShowOriginal, setSeamlessShowOriginal] = useState(false)

  const seamlessOriginalImageRef = useRef<HTMLImageElement | null>(null)
  const seamlessTilingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const seamlessGeneratedCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Debounce timer for preview re-render triggered by slider changes
  const seamlessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tab 7: Atlas Forge (Sprite Packer) State
  const [atlasFolderPath, setAtlasFolderPath] = useState<string | null>(null)
  const [atlasSprites, setAtlasSprites] = useState<Array<{ name: string; path: string; dataUrl: string }>>([])
  const [atlasPadding, setAtlasPadding] = useState(2)
  const [atlasMaxSize, setAtlasMaxSize] = useState<1024 | 2048 | 4096>(2048)
  const [atlasAutoTrim, setAtlasAutoTrim] = useState(true)
  const [isAtlasPacking, setIsAtlasPacking] = useState(false)
  const [isAtlasSaving, setIsAtlasSaving] = useState(false)
  const [atlasExportedPng, setAtlasExportedPng] = useState<string | null>(null)
  const [atlasExportedJson, setAtlasExportedJson] = useState<string | null>(null)
  const [atlasLayout, setAtlasLayout] = useState<{ size: number; blocks: any[] } | null>(null)
  const atlasPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Tab 8: Sprite Slicer State
  const [slicerPath, setSlicerPath] = useState<string | null>(null)
  const [slicerUrl, setSlicerUrl] = useState<string | null>(null)
  const [sliceMode, setSliceMode] = useState<'grid' | 'auto'>('grid')
  const [sliceCellW, setSliceCellW] = useState(32)
  const [sliceCellH, setSliceCellH] = useState(32)
  const [slicedFrames, setSlicedFrames] = useState<Array<{ index: number; dataUrl: string; bounds: { x: number; y: number; w: number; h: number } }>>([])
  const [isSlicerProcessing, setIsSlicerProcessing] = useState(false)
  const [isSlicerSaving, setIsSlicerSaving] = useState(false)
  const [slicerExportedCount, setSlicerExportedCount] = useState<number | null>(null)
  const slicerPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [slicerDims, setSlicerDims] = useState<{ w: number; h: number } | null>(null)

  // Tab 9: LUT Color Grader State
  const [lutBrightness, setLutBrightness] = useState(0)
  const [lutContrast, setLutContrast] = useState(0)
  const [lutSaturation, setLutSaturation] = useState(0)
  const [lutTemperature, setLutTemperature] = useState(0)
  const [lutExposure, setLutExposure] = useState(0)
  const [lutExportedPath, setLutExportedPath] = useState<string | null>(null)
  const [isLutSaving, setIsLutSaving] = useState(false)
  const lutPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Tab 10: Pixel Art Upscaler State
  const [upscalePath, setUpscalePath] = useState<string | null>(null)
  const [upscaleUrl, setUpscaleUrl] = useState<string | null>(null)
  const [upscaleAlgorithm, setUpscaleAlgorithm] = useState<'nearest2x' | 'nearest4x' | 'nearest8x' | 'scale2x' | 'scale3x' | 'scale4x'>('scale2x')
  const [upscaleExportedPath, setUpscaleExportedPath] = useState<string | null>(null)
  const [isUpscaleSaving, setIsUpscaleSaving] = useState(false)
  const [upscaleDims, setUpscaleDims] = useState<{ w: number; h: number; ow: number; oh: number } | null>(null)
  const [upscaleShowOriginal, setUpscaleShowOriginal] = useState(false)
  const upscalePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [renamerSuffixPreset, setRenamerSuffixPreset] = useState<'none' | 'diffuse' | 'normal'>('none')
  const [searchStr, setSearchStr] = useState('')
  const [replaceStr, setReplaceStr] = useState('')
  const [customPrefix, setCustomPrefix] = useState('')
  const [customSuffix, setCustomSuffix] = useState('')
  const [enableIndexing, setEnableIndexing] = useState(false)
  const [startIndex, setStartIndex] = useState(1)
  const [indexPadding, setIndexPadding] = useState(2)
  const [renaming, setRenaming] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // Tab 3: Dialogue Quest Flow State
  const [dialogueNodes, setDialogueNodes] = useState<DialogueNode[]>([
    { id: 'start', speaker: 'Hero', text: 'Hello traveler, do you have any quests?', choices: [{ text: 'Yes, help me!', nextId: 'quest_accept' }, { text: 'No, begone.', nextId: 'quit' }] },
    { id: 'quest_accept', speaker: 'Elder', text: 'Slay 5 wolves in the valley.', choices: [{ text: 'I will do it.', nextId: 'quest_active' }] },
    { id: 'quest_active', speaker: 'Narrator', text: 'Quest added: Wolf Hunter.', choices: [] },
    { id: 'quit', speaker: 'Elder', text: 'Hmph. Safe travels.', choices: [] }
  ])
  const [nodeSpeaker, setNodeSpeaker] = useState('')
  const [nodeText, setNodeText] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [dialogueViewMode, setDialogueViewMode] = useState<'code' | 'visual'>('visual')
  const [dialogueChoiceInputs, setDialogueChoiceInputs] = useState<Record<string, { text: string; nextId: string }>>({})

  useEffect(() => {
    const handleAiDialogueLoad = (evt: CustomEvent) => {
      const detail = evt.detail
      if (detail && Array.isArray(detail.nodes)) {
        const formatted = detail.nodes.map((n: any) => ({
          id: n.id || `node_${Math.random().toString(36).substr(2, 5)}`,
          speaker: n.speaker || 'NPC',
          text: n.text || '',
          choices: Array.isArray(n.choices) ? n.choices.map((c: any) => ({ text: c.text, nextId: c.target || c.nextId || '' })) : []
        }))
        setDialogueNodes(formatted)
        setActiveTab('dialogue')
        toast('Loaded AI Dialogue Quest Tree into Workspace!', { type: 'success' })
      }
    }
    window.addEventListener('ai-load-dialogue-tree' as any, handleAiDialogueLoad)
    return () => window.removeEventListener('ai-load-dialogue-tree' as any, handleAiDialogueLoad)
  }, [toast])

  // Tab 4: Shader Palette State
  const [paletteColors, setPaletteColors] = useState<string[]>(PALETTE_COLORS)
  const [newColor, setNewColor] = useState('#3b82f6')

  // PBR Map Generator Functions
  const loadTexturePath = useCallback(async (path: string) => {
    setIsProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.loadTexture(path)
      if (res) {
        setAlbedoPath(res.path)
        setAlbedoUrl(res.dataUrl)
        setExportedFiles([])
      } else {
        toast('Failed to load preloaded texture file.', { type: 'error' })
      }
    } catch (err) {
      console.error(err)
      toast('Error loading preloaded texture.', { type: 'error' })
    } finally {
      setIsProcessing(false)
    }
  }, [toast])

  const moveCardToDone = useCallback(async (cardId: string) => {
    try {
      const activeContext = useAppStore.getState().activeContext
      const key = `kanban_columns_${activeContext}`
      const colsVal = await window.electronAPI.db.getSetting(key)
      let doneColId = 'done'
      if (colsVal) {
        const cols = JSON.parse(colsVal as string)
        const doneCol = cols.find((c: any) => c.id === 'done' || c.name.toLowerCase().includes('done'))
        if (doneCol) {
          doneColId = doneCol.id
        }
      }
      await window.electronAPI.db.updateItem(cardId, { status: doneColId })
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      toast('Success: Ticket moved to Done!', { type: 'success' })
    } catch (err) {
      console.error('Failed to move card to done:', err)
      toast('Failed to move card to Done', { type: 'error' })
    }
  }, [toast])

  const handlePbrDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handlePbrDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    if (!file.type.startsWith('image/')) {
      toast('Invalid File: Please drop an image file.', { type: 'error' })
      return
    }

    setIsProcessing(true)
    try {
      // Electron ≥32: File.path no longer exists, resolve via preload webUtils
      const path = window.electronAPI.app.getPathForFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        setAlbedoPath(path)
        setAlbedoUrl(event.target?.result as string)
        setExportedFiles([])
        setIsProcessing(false)
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error(err)
      toast('Failed to read dropped file.', { type: 'error' })
      setIsProcessing(false)
    }
  }, [toast])

  const handleBrowseClick = useCallback(async () => {
    setIsProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.selectTexture()
      if (res) {
        setAlbedoPath(res.path)
        setAlbedoUrl(res.dataUrl)
        setExportedFiles([])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // Sobel-based real-time 2D pixel calculations, delegates to shared computePbrMaps()
  const processTextures = useCallback(() => {
    const img = originalImageRef.current
    if (!img) return

    const size = 512
    const offCanvas = document.createElement('canvas')
    offCanvas.width = size
    offCanvas.height = size
    const offCtx = offCanvas.getContext('2d')
    if (!offCtx) return
    offCtx.drawImage(img, 0, 0, size, size)
    const src = offCtx.getImageData(0, 0, size, size).data

    const heightCanvas = heightCanvasRef.current
    const normalCanvas = normalCanvasRef.current
    const roughnessCanvas = roughnessCanvasRef.current
    const aoCanvas = aoCanvasRef.current
    if (!heightCanvas || !normalCanvas || !roughnessCanvas || !aoCanvas) return

    const heightCtx = heightCanvas.getContext('2d')
    const normalCtx = normalCanvas.getContext('2d')
    const roughnessCtx = roughnessCanvas.getContext('2d')
    const aoCtx = aoCanvas.getContext('2d')
    if (!heightCtx || !normalCtx || !roughnessCtx || !aoCtx) return

    const { hData, nData, rData, aData } = computePbrMaps(src, size, size, {
      normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight
    })

    heightCtx.putImageData(new ImageData(hData, size, size), 0, 0)
    normalCtx.putImageData(new ImageData(nData, size, size), 0, 0)
    roughnessCtx.putImageData(new ImageData(rData, size, size), 0, 0)
    aoCtx.putImageData(new ImageData(aData, size, size), 0, 0)

    if (threeTexturesRef.current.map) threeTexturesRef.current.map.needsUpdate = true
    if (threeTexturesRef.current.normalMap) threeTexturesRef.current.normalMap.needsUpdate = true
    if (threeTexturesRef.current.bumpMap) threeTexturesRef.current.bumpMap.needsUpdate = true
    if (threeTexturesRef.current.roughnessMap) threeTexturesRef.current.roughnessMap.needsUpdate = true
    if (threeTexturesRef.current.aoMap) threeTexturesRef.current.aoMap.needsUpdate = true
  }, [normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight])

  // Full-resolution export, also delegates to computePbrMaps() for identical output
  const handleExport = useCallback(async () => {
    const img = originalImageRef.current
    if (!img || !albedoPath) return
    setIsSaving(true)

    try {
      const W = img.width
      const H = img.height

      const offCanvas = document.createElement('canvas')
      offCanvas.width = W
      offCanvas.height = H
      const offCtx = offCanvas.getContext('2d')
      if (!offCtx) throw new Error('Could not create canvas context')
      offCtx.drawImage(img, 0, 0)
      const src = offCtx.getImageData(0, 0, W, H).data

      const { hData, nData, rData, aData } = computePbrMaps(src, W, H, {
        normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight
      })

      // Convert each typed array to a data URL via an off-screen canvas
      const toDataUrl = (data: Uint8ClampedArray<ArrayBuffer>) => {
        const c = document.createElement('canvas')
        c.width = W; c.height = H
        c.getContext('2d')!.putImageData(new ImageData(data, W, H), 0, 0)
        return c.toDataURL('image/png')
      }

      const maps = {
        normal:    toDataUrl(nData),
        height:    toDataUrl(hData),
        roughness: toDataUrl(rData),
        ao:        toDataUrl(aData)
      }

      const res = await window.electronAPI.gamedev.saveMaps({ albedoPath, maps })
      if (res.success) {
        toast('PBR maps exported next to original Albedo texture!', { type: 'success' })
        setExportedFiles(res.writtenFiles)
      } else {
        throw new Error(res.error || 'Failed to save maps')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }, [albedoPath, normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight, toast])

  // Watch preload texture path from appStore
  useEffect(() => {
    if (preloadTexturePath) {
      setActiveTab('pbr')
      loadTexturePath(preloadTexturePath)
    }
  }, [preloadTexturePath, loadTexturePath])

  const loadSeamlessPath = useCallback(async (path: string) => {
    setIsSeamlessProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.loadTexture(path)
      if (res) {
        setSeamlessPath(res.path)
        setSeamlessUrl(res.dataUrl)
        setSeamlessExportedFile(null)
      }
    } catch (err: any) {
      console.error(err)
      toast('Failed to load preloaded seamless texture', { type: 'error' })
    } finally {
      setIsSeamlessProcessing(false)
    }
  }, [toast])

  // Watch preload seamless path from appStore
  useEffect(() => {
    if (preloadSeamlessPath) {
      setActiveTab('seamless')
      loadSeamlessPath(preloadSeamlessPath)
    }
  }, [preloadSeamlessPath, loadSeamlessPath])

  // Seamless processing math
  //
  // Best practices applied:
  //   1. All parameters are explicit, no closure captures. Empty dep array = stable ref.
  //   2. Center offset uses Math.round() to prevent half-pixel drift on odd dimensions.
  //   3. Toroidal luminance equalisation pad avoids edge-bleed from CSS blur().
  //   4. Four-offset separable blend: every seam of every wrap-offset copy gets
  //      exactly zero weight, so the result is fully seamless by construction
  //      (see the detailed derivation at the blend loop below).
  //   5. Wave modulation is multiplicative on the border distance, so tile-edge
  //      continuity is preserved for any wave amplitude.
  const runSeamlessStitch = useCallback((
    img: HTMLImageElement,
    blendWidth: number,
    algorithm: 'mirror' | 'feather',
    equalizer: number,
    wavySeams: number,
    targetW: number,
    targetH: number,
    outCanvas: HTMLCanvasElement
  ) => {
    outCanvas.width = targetW
    outCanvas.height = targetH
    const ctx = outCanvas.getContext('2d')
    if (!ctx) return

    if (algorithm === 'mirror') {
      // 4-quadrant mirror: fast path, no pixel-level work required
      const w2 = Math.round(targetW / 2)
      const h2 = Math.round(targetH / 2)

      ctx.drawImage(img, 0, 0, w2, h2)

      ctx.save()
      ctx.translate(targetW, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img, 0, 0, w2, h2)
      ctx.restore()

      ctx.save()
      ctx.translate(0, targetH)
      ctx.scale(1, -1)
      ctx.drawImage(img, 0, 0, w2, h2)
      ctx.restore()

      ctx.save()
      ctx.translate(targetW, targetH)
      ctx.scale(-1, -1)
      ctx.drawImage(img, 0, 0, w2, h2)
      ctx.restore()
    } else {
      // 1. Draw source to temp canvas with optional Brightness Equalisation (toroidal High-Pass)
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = targetW
      srcCanvas.height = targetH
      const srcCtx = srcCanvas.getContext('2d')
      if (!srcCtx) return
      srcCtx.drawImage(img, 0, 0, targetW, targetH)

      const srcData = srcCtx.getImageData(0, 0, targetW, targetH)
      const src = srcData.data

      let equalizedData: Uint8ClampedArray | null = null
      if (equalizer > 0) {
        // Toroidal padded canvas to completely avoid edge-fading blur artefacts
        const padW = Math.max(32, Math.round(targetW / 8))
        const padH = Math.max(32, Math.round(targetH / 8))

        const padCanvas = document.createElement('canvas')
        padCanvas.width = targetW + padW * 2
        padCanvas.height = targetH + padH * 2
        const padCtx = padCanvas.getContext('2d')

        if (padCtx) {
          // Centre original
          padCtx.drawImage(srcCanvas, padW, padH)
          // Edge tiles (toroidal wrap)
          padCtx.drawImage(srcCanvas, targetW - padW, 0,           padW,    targetH, 0,            padH,           padW,    targetH) // Left
          padCtx.drawImage(srcCanvas, 0,           0,           padW,    targetH, targetW + padW, padH,           padW,    targetH) // Right
          padCtx.drawImage(srcCanvas, 0,           targetH - padH, targetW, padH,    padW,          0,              targetW, padH)    // Top
          padCtx.drawImage(srcCanvas, 0,           0,           targetW, padH,    padW,          targetH + padH, targetW, padH)    // Bottom
          // Corner tiles
          padCtx.drawImage(srcCanvas, targetW - padW, targetH - padH, padW, padH, 0,            0,            padW, padH) // TL
          padCtx.drawImage(srcCanvas, 0,           targetH - padH, padW, padH, targetW + padW, 0,            padW, padH) // TR
          padCtx.drawImage(srcCanvas, targetW - padW, 0,           padW, padH, 0,            targetH + padH, padW, padH) // BL
          padCtx.drawImage(srcCanvas, 0,           0,           padW, padH, targetW + padW, targetH + padH, padW, padH) // BR

          const blurCanvas = document.createElement('canvas')
          blurCanvas.width = targetW
          blurCanvas.height = targetH
          const blurCtx = blurCanvas.getContext('2d')
          if (blurCtx) {
            const blurRadius = Math.max(8, Math.round(Math.min(targetW, targetH) / 16))
            blurCtx.filter = `blur(${blurRadius}px)`
            blurCtx.drawImage(padCanvas, -padW, -padH)

            const blurData = blurCtx.getImageData(0, 0, targetW, targetH).data

            // Sample average colour of source (every 8th pixel for speed)
            let sumR = 0, sumG = 0, sumB = 0, sampleCount = 0
            for (let i = 0; i < src.length; i += 4 * 8) {
              sumR += src[i]; sumG += src[i + 1]; sumB += src[i + 2]; sampleCount++
            }
            const avgR = sumR / sampleCount
            const avgG = sumG / sampleCount
            const avgB = sumB / sampleCount

            equalizedData = new Uint8ClampedArray(src.length)
            const eqStr = equalizer
            for (let i = 0; i < src.length; i += 4) {
              const eqR = Math.max(0, Math.min(255, avgR + (src[i]     - blurData[i])))
              const eqG = Math.max(0, Math.min(255, avgG + (src[i + 1] - blurData[i + 1])))
              const eqB = Math.max(0, Math.min(255, avgB + (src[i + 2] - blurData[i + 2])))
              equalizedData[i]     = src[i]     * (1 - eqStr) + eqR * eqStr
              equalizedData[i + 1] = src[i + 1] * (1 - eqStr) + eqG * eqStr
              equalizedData[i + 2] = src[i + 2] * (1 - eqStr) + eqB * eqStr
              equalizedData[i + 3] = src[i + 3]
            }
          }
        }
      }

      const activeSrc = equalizedData || src

      // 2. Four-offset separable border blend.
      //
      // A two-sample "half-shift + blend the centre cross" can never be fully
      // seamless: wherever a cross arm meets the tile border, either the
      // original's border mismatch or the shifted copy's centre seam is
      // exposed, visible as short "whisker" artefacts at tile-boundary
      // midpoints. Blending FOUR wrap-offset copies with separable weights
      // gives every seam of every copy exactly zero weight:
      //   S00 unshifted, seams at the borders          (w = ax·ay)
      //   S10 x-shifted by cx, seams at x=cx and y-borders   (w = bx·ay)
      //   S01 y-shifted by cy, seams at y=cy and x-borders   (w = ax·by)
      //   S11 xy-shifted, seams at x=cx and y=cy        (w = bx·by)
      // ax rises 0→1 over the blend band measured inward from the x-borders:
      // it is 0 at the borders (hiding S00/S01 there) and 1 in the interior
      // (where bx = 1−ax = 0 hides S10/S11's centre seams). ay likewise.
      // The border ring is therefore toroidally continuous by construction
      // and the interior remains the untouched original.
      const outImgData = ctx.createImageData(targetW, targetH)
      const dst = outImgData.data

      // Integer center prevents sub-pixel drift on odd-dimension textures
      const cx = Math.round(targetW / 2)
      const cy = Math.round(targetH / 2)
      // Blend band width, clamped so it can never reach the shifted copies'
      // centre seams (which must stay strictly inside the bx=0 region).
      const B_w = Math.min(cx - 2, Math.max(4, Math.round(targetW * blendWidth)))
      const B_h = Math.min(cy - 2, Math.max(4, Math.round(targetH * blendWidth)))

      // Toroidal coordinate wrap that handles negative values correctly
      const wrapVal = (v: number, limit: number) =>
        ((Math.round(v) % limit) + limit) % limit

      const sampleAt = (px: number, py: number): number =>
        (wrapVal(py, targetH) * targetW + wrapVal(px, targetW)) * 4

      // Low-cost deterministic 2D hash for dithering the blend transitions
      const hash2d = (x: number, y: number) => {
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123
        return h - Math.floor(h)
      }

      const smooth01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v))

      for (let y = 0; y < targetH; y++) {
        // Wave along the x-transition, driven by y (toroidally periodic, 
        // whole numbers of cycles, so it matches across tile copies)
        const angleX = (2 * Math.PI * 3 * y) / targetH
        const waveX = Math.sin(angleX) * 0.08 + Math.cos(angleX * 2) * 0.03

        const dyB = Math.min(y, targetH - 1 - y)

        for (let x = 0; x < targetW; x++) {
          const idx = (y * targetW + x) * 4

          const angleY = (2 * Math.PI * 3 * x) / targetW
          const waveY = Math.sin(angleY) * 0.08 + Math.cos(angleY * 2) * 0.03

          const dxB = Math.min(x, targetW - 1 - x)

          // Normalised distance inward from the nearest border. The wave
          // modulates multiplicatively so the value stays exactly 0 at the
          // border, continuity across tile copies is never broken.
          let ax = smooth01((dxB / B_w) * (1 + waveX * wavySeams))
          let ay = smooth01((dyB / B_h) * (1 + waveY * wavySeams))

          // Dither the transition zones to mask any residual banding
          if (wavySeams > 0) {
            if (ax > 0.02 && ax < 0.98) {
              ax = Math.max(0, Math.min(1, ax + (hash2d(x, y) - 0.5) * 0.12 * wavySeams))
            }
            if (ay > 0.02 && ay < 0.98) {
              ay = Math.max(0, Math.min(1, ay + (hash2d(x + 131.7, y + 57.3) - 0.5) * 0.12 * wavySeams))
            }
          }

          const i00 = sampleAt(x, y)

          // Fast path: the interior (the vast majority of pixels) is the
          // untouched original, skip the other three samples entirely.
          if (ax === 1 && ay === 1) {
            dst[idx]     = activeSrc[i00]
            dst[idx + 1] = activeSrc[i00 + 1]
            dst[idx + 2] = activeSrc[i00 + 2]
            dst[idx + 3] = activeSrc[i00 + 3]
            continue
          }

          const bx = 1 - ax
          const by = 1 - ay
          const w00 = ax * ay
          const w10 = bx * ay
          const w01 = ax * by
          const w11 = bx * by

          const i10 = sampleAt(x + cx, y)
          const i01 = sampleAt(x, y + cy)
          const i11 = sampleAt(x + cx, y + cy)

          dst[idx]     = Math.round(activeSrc[i00] * w00 + activeSrc[i10] * w10 + activeSrc[i01] * w01 + activeSrc[i11] * w11)
          dst[idx + 1] = Math.round(activeSrc[i00 + 1] * w00 + activeSrc[i10 + 1] * w10 + activeSrc[i01 + 1] * w01 + activeSrc[i11 + 1] * w11)
          dst[idx + 2] = Math.round(activeSrc[i00 + 2] * w00 + activeSrc[i10 + 2] * w10 + activeSrc[i01 + 2] * w01 + activeSrc[i11 + 2] * w11)
          dst[idx + 3] = Math.round(activeSrc[i00 + 3] * w00 + activeSrc[i10 + 3] * w10 + activeSrc[i01 + 3] * w01 + activeSrc[i11 + 3] * w11)
        }
      }

      ctx.putImageData(outImgData, 0, 0)
    }
  }, []) // No deps: all inputs arrive as explicit parameters, stable reference

  // Helper that tiles a canvas (either the seamless result or the raw original)
  // onto the visible tiling preview canvas, optionally overlaying grid lines.
  // Tiles are drawn at the source's true aspect ratio, a 2:1 texture renders
  // as 2:1 tiles instead of being squashed into squares.
  //
  // The tile is downscaled ONCE into an integer-sized stamp, then blitted as
  // byte-identical unscaled copies. Scaling each tile individually (and at
  // fractional positions) filters every tile's edges independently, which
  // shows up as faint hairlines along the tile boundaries, artifacts of the
  // preview, not the texture.
  const drawTilingCanvas = useCallback((
    sourceCanvas: HTMLCanvasElement | HTMLImageElement,
    reps: number,
    showGrid: boolean,
    aspect: number = 1
  ) => {
    const tilingCanvas = seamlessTilingCanvasRef.current
    if (!tilingCanvas) return
    tilingCanvas.width = 600
    tilingCanvas.height = 600
    const ctx = tilingCanvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, 600, 600)

    const tileW = Math.max(1, Math.round(600 / reps))
    const tileH = Math.max(1, Math.round(tileW / (aspect || 1)))

    const stamp = document.createElement('canvas')
    stamp.width = tileW
    stamp.height = tileH
    const sctx = stamp.getContext('2d')
    if (!sctx) return
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(sourceCanvas, 0, 0, tileW, tileH)

    const cols = Math.ceil(600 / tileW)
    const rows = Math.ceil(600 / tileH)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        ctx.drawImage(stamp, col * tileW, row * tileH)
      }
    }
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 1; i < cols; i++) {
        ctx.moveTo(i * tileW, 0); ctx.lineTo(i * tileW, 600)
      }
      for (let i = 1; i < rows; i++) {
        ctx.moveTo(0, i * tileH); ctx.lineTo(600, i * tileH)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [])

  const updateSeamlessPreview = useCallback(() => {
    const img = seamlessOriginalImageRef.current
    if (!img) return

    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const aspect = srcW > 0 && srcH > 0 ? srcW / srcH : 1

    if (seamlessShowOriginal) {
      // Before/after compare: tile the unmodified source image directly
      drawTilingCanvas(img, seamlessTilingScale, seamlessShowGrid, aspect)
      return
    }

    // Ensure we have a persistent off-screen canvas for the single generated tile
    let singleTileCanvas = seamlessGeneratedCanvasRef.current
    if (!singleTileCanvas) {
      singleTileCanvas = document.createElement('canvas')
      seamlessGeneratedCanvasRef.current = singleTileCanvas
    }

    // Preview at aspect-correct proxy resolution (longest side 512) so the
    // stitch math sees the same proportions the full-resolution export will.
    const previewW = aspect >= 1 ? 512 : Math.max(64, Math.round(512 * aspect))
    const previewH = aspect >= 1 ? Math.max(64, Math.round(512 / aspect)) : 512

    runSeamlessStitch(
      img,
      seamlessBlendWidth,
      seamlessAlgorithm,
      seamlessEqualizer,
      seamlessWavySeams,
      previewW,
      previewH,
      singleTileCanvas
    )

    drawTilingCanvas(singleTileCanvas, seamlessTilingScale, seamlessShowGrid, aspect)
  }, [
    seamlessBlendWidth, seamlessAlgorithm, seamlessTilingScale,
    seamlessShowGrid, seamlessShowOriginal, seamlessEqualizer, seamlessWavySeams,
    runSeamlessStitch, drawTilingCanvas
  ])

  // Debounced wrapper so rapid slider drags don't block the UI thread
  const updateSeamlessPreviewDebounced = useCallback(() => {
    if (seamlessDebounceRef.current) clearTimeout(seamlessDebounceRef.current)
    seamlessDebounceRef.current = setTimeout(() => updateSeamlessPreview(), 80)
  }, [updateSeamlessPreview])

  useEffect(() => {
    if (!seamlessUrl) return
    const img = new Image()
    img.onload = () => {
      seamlessOriginalImageRef.current = img
      // Warn the user if the texture is extremely large (processing is synchronous)
      if (img.naturalWidth * img.naturalHeight > 4096 * 4096) {
        toast(
          `Large texture warning: ${img.naturalWidth}×${img.naturalHeight}px. ` +
          'Processing this at full resolution during export may be slow. Consider downscaling first.',
          { type: 'warning' }
        )
      }
      updateSeamlessPreview()
    }
    img.src = seamlessUrl
  }, [seamlessUrl, updateSeamlessPreview, toast])

  useEffect(() => {
    if (activeTab === 'seamless') {
      updateSeamlessPreview()
    }
  }, [activeTab, seamlessBlendWidth, seamlessAlgorithm, seamlessTilingScale, seamlessShowGrid, seamlessShowOriginal, updateSeamlessPreview])

  const handleSeamlessExport = useCallback(async () => {
    const img = seamlessOriginalImageRef.current
    if (!img || !seamlessPath) return

    setIsSeamlessSaving(true)
    try {
      const originalW = img.naturalWidth || img.width
      const originalH = img.naturalHeight || img.height

      if (originalW * originalH > 8192 * 8192) {
        throw new Error('Image dimensions exceed 8K limit. Please downscale first.')
      }

      const exportCanvas = document.createElement('canvas')
      runSeamlessStitch(
        img,
        seamlessBlendWidth,
        seamlessAlgorithm,
        seamlessEqualizer,
        seamlessWavySeams,
        originalW,
        originalH,
        exportCanvas
      )

      const base64Data = exportCanvas.toDataURL('image/png')
      const res = await window.electronAPI.gamedev.saveSeamless({
        originalPath: seamlessPath,
        dataUrl: base64Data
      })

      if (res.success) {
        toast('Seamless texture exported next to original asset!', { type: 'success' })
        setSeamlessExportedFile(res.filePath || 'saved')
      } else {
        throw new Error(res.error || 'Failed to save seamless texture')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsSeamlessSaving(false)
    }
  }, [seamlessPath, seamlessBlendWidth, seamlessAlgorithm, seamlessEqualizer, seamlessWavySeams, runSeamlessStitch, toast])

  const handleSeamlessDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleSeamlessDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    if (!file.type.startsWith('image/')) {
      toast('Invalid File: Please drop an image file.', { type: 'error' })
      return
    }

    setIsSeamlessProcessing(true)
    setSeamlessShowOriginal(false) // reset compare to 'result' on new file
    try {
      // Electron ≥32: File.path no longer exists, resolve via preload webUtils
      const path = window.electronAPI.app.getPathForFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        setSeamlessPath(path)
        setSeamlessUrl(event.target?.result as string)
        setSeamlessExportedFile(null)
        setIsSeamlessProcessing(false)
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error(err)
      toast('Failed to read dropped file.', { type: 'error' })
      setIsSeamlessProcessing(false)
    }
  }, [toast])

  const handleSeamlessBrowseClick = useCallback(async () => {
    setIsSeamlessProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.selectTexture()
      if (res) {
        setSeamlessPath(res.path)
        setSeamlessUrl(res.dataUrl)
        setSeamlessExportedFile(null)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsSeamlessProcessing(false)
    }
  }, [])

  // Tab 7: Atlas Forge (Sprite Packer) Callbacks
  const handleSelectAtlasFolder = useCallback(async () => {
    try {
      const res = await window.electronAPI.gamedev.selectSpriteFolder()
      if (res) {
        setAtlasFolderPath(res.path)
        setAtlasSprites(res.files)
        setAtlasExportedPng(null)
        setAtlasExportedJson(null)
        setAtlasLayout(null)
        toast(`Loaded ${res.files.length} sprite(s).`, { type: 'success' })
      }
    } catch (err) {
      console.error(err)
      toast('Failed to select directory.', { type: 'error' })
    }
  }, [toast])

  const runAtlasPack = useCallback(async () => {
    if (atlasSprites.length === 0) return

    setIsAtlasPacking(true)
    try {
      // 1. Asynchronously load all image sources
      const loaded = await Promise.all(
        atlasSprites.map(async (sprite) => {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject()
            image.src = sprite.dataUrl
          })
          return { name: sprite.name, path: sprite.path, img }
        })
      )

      // Helper to compute trimmed bounds
      const getTrimmedBounds = (imgData: ImageData) => {
        const { width, height, data } = imgData
        let minX = width, minY = height, maxX = -1, maxY = -1
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3]
            if (alpha > 4) {
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
        }
        if (maxX === -1 || maxY === -1) return null
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
      }

      // 2. Compute trimmed bounds and packing blocks
      const blocks = loaded.map(({ name, path, img }) => {
        let trimmed = false
        let frameX = 0, frameY = 0, frameW = img.width, frameH = img.height

        if (atlasAutoTrim) {
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = img.width
          tempCanvas.height = img.height
          const tempCtx = tempCanvas.getContext('2d')
          if (tempCtx) {
            tempCtx.drawImage(img, 0, 0)
            const bounds = getTrimmedBounds(tempCtx.getImageData(0, 0, img.width, img.height))
            if (bounds) {
              frameX = bounds.x
              frameY = bounds.y
              frameW = bounds.w
              frameH = bounds.h
              trimmed = true
            }
          }
        }

        return {
          name,
          path,
          img,
          w: frameW + atlasPadding * 2,
          h: frameH + atlasPadding * 2,
          frameX,
          frameY,
          frameW,
          frameH,
          originalW: img.width,
          originalH: img.height,
          trimmed,
          fit: null as any
        }
      })

      // 3. Find smallest fitting size
      const sizes = [128, 256, 512, 1024, 2048, 4096]
      const allowedSizes = sizes.filter(s => s <= atlasMaxSize)
      let finalSize: number = atlasMaxSize
      let fitsAll = false

      // Sort blocks by max side descending (helps packing efficiency)
      blocks.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.h - a.h)

      for (const size of allowedSizes) {
        // Reset fits
        blocks.forEach(b => b.fit = null)

        const packer = new BinaryTreePacker(size, size)
        let fitsThisSize = true

        for (const block of blocks) {
          const pos = packer.fit(block.w, block.h)
          if (pos) {
            block.fit = pos
          } else {
            fitsThisSize = false
            break
          }
        }

        if (fitsThisSize) {
          finalSize = size
          fitsAll = true
          break
        }
      }

      // If it doesn't fit in any, run packer on max size and let some remain unpacked
      if (!fitsAll) {
        blocks.forEach(b => b.fit = null)
        const packer = new BinaryTreePacker(atlasMaxSize, atlasMaxSize)
        for (const block of blocks) {
          block.fit = packer.fit(block.w, block.h)
        }
        toast('Warning: Not all sprites fit in the maximum atlas size. Try increasing Max Atlas Size.', { type: 'warning' })
      }

      // 4. Render to Preview Canvas
      const canvas = atlasPreviewCanvasRef.current
      if (canvas) {
        canvas.width = finalSize
        canvas.height = finalSize
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, finalSize, finalSize)

          // Draw transparent checkerboard background
          const chkSize = 8
          for (let y = 0; y < finalSize; y += chkSize * 2) {
            for (let x = 0; x < finalSize; x += chkSize * 2) {
              ctx.fillStyle = '#1a1b20'
              ctx.fillRect(x, y, chkSize, chkSize)
              ctx.fillRect(x + chkSize, y + chkSize, chkSize, chkSize)
              ctx.fillStyle = '#141518'
              ctx.fillRect(x + chkSize, y, chkSize, chkSize)
              ctx.fillRect(x, y + chkSize, chkSize, chkSize)
            }
          }

          // Draw sprites and outlines
          blocks.forEach(block => {
            if (!block.fit) return

            const dx = block.fit.x + atlasPadding
            const dy = block.fit.y + atlasPadding

            // Draw Sprite
            ctx.drawImage(
              block.img,
              block.frameX, block.frameY, block.frameW, block.frameH,
              dx, dy, block.frameW, block.frameH
            )

            // Draw bounding box outline
            ctx.strokeStyle = 'rgba(0, 255, 128, 0.4)'
            ctx.lineWidth = 1
            ctx.strokeRect(dx, dy, block.frameW, block.frameH)

            // Draw padding/outer boundary
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
            ctx.strokeRect(block.fit.x, block.fit.y, block.w, block.h)
          })
        }
      }

      setAtlasLayout({ size: finalSize, blocks })

    } catch (err) {
      console.error(err)
      toast('Packing Error: ' + String(err), { type: 'error' })
    } finally {
      setIsAtlasPacking(false)
    }
  }, [atlasSprites, atlasPadding, atlasMaxSize, atlasAutoTrim, toast])

  const handleAtlasExport = useCallback(async () => {
    if (!atlasFolderPath || !atlasLayout) return

    setIsAtlasSaving(true)
    try {
      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = atlasLayout.size
      exportCanvas.height = atlasLayout.size
      const ctx = exportCanvas.getContext('2d')
      if (!ctx) throw new Error('Could not create export canvas context')

      atlasLayout.blocks.forEach((block: any) => {
        if (!block.fit) return
        ctx.drawImage(
          block.img,
          block.frameX, block.frameY, block.frameW, block.frameH,
          block.fit.x + atlasPadding, block.fit.y + atlasPadding, block.frameW, block.frameH
        )
      })

      const frames: Record<string, any> = {}
      atlasLayout.blocks.forEach((block: any) => {
        if (!block.fit) return
        frames[block.name] = {
          frame: {
            x: block.fit.x + atlasPadding,
            y: block.fit.y + atlasPadding,
            w: block.frameW,
            h: block.frameH
          },
          rotated: false,
          trimmed: block.trimmed,
          spriteSourceSize: {
            x: block.frameX,
            y: block.frameY,
            w: block.frameW,
            h: block.frameH
          },
          sourceSize: {
            w: block.originalW,
            h: block.originalH
          }
        }
      })

      const atlasJsonObj = {
        frames,
        meta: {
          app: 'Checkpoint Atlas Forge',
          version: '1.0',
          image: 'atlas.png',
          format: 'RGBA8888',
          size: { w: atlasLayout.size, h: atlasLayout.size },
          scale: '1'
        }
      }

      const base64Data = exportCanvas.toDataURL('image/png')
      const res = await window.electronAPI.gamedev.saveSpriteAtlas({
        folderPath: atlasFolderPath,
        atlasDataUrl: base64Data,
        atlasJson: JSON.stringify(atlasJsonObj, null, 2)
      })

      if (res.success) {
        toast('Sprite Atlas and JSON metadata successfully exported to folder!', { type: 'success' })
        setAtlasExportedPng(res.pngPath || 'atlas.png')
        setAtlasExportedJson(res.jsonPath || 'atlas.json')
      } else {
        throw new Error(res.error || 'Failed to export')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsAtlasSaving(false)
    }
  }, [atlasFolderPath, atlasLayout, atlasPadding, toast])

  // Run whenever sprites or packing settings change. No activeTab guard needed:
  // runAtlasPack is a no-op when atlasSprites is empty, and this effect
  // only fires when the listed deps change, not on every tab switch.
  useEffect(() => {
    runAtlasPack()
  }, [atlasSprites, atlasPadding, atlasMaxSize, atlasAutoTrim, runAtlasPack])

  // Tab 8: Sprite Slicer Callbacks
  const handleSelectSlicerFile = useCallback(async () => {
    setIsSlicerProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.selectTexture()
      if (res) {
        setSlicerPath(res.path)
        setSlicerUrl(res.dataUrl)
        setSlicedFrames([])
        setSlicerExportedCount(null)
      }
    } catch (err) {
      console.error(err)
      toast('Failed to select sprite sheet file.', { type: 'error' })
    } finally {
      setIsSlicerProcessing(false)
    }
  }, [toast])

  const runSlicer = useCallback(async () => {
    if (!slicerUrl) return

    setIsSlicerProcessing(true)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject()
        image.src = slicerUrl
      })

      setSlicerDims({ w: img.width, h: img.height })

      const canvas = slicerPreviewCanvasRef.current
      if (!canvas) return
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)

      let boundsList: Array<{ x: number; y: number; w: number; h: number }> = []

      if (sliceMode === 'grid') {
        const cols = Math.floor(img.width / sliceCellW)
        const rows = Math.floor(img.height / sliceCellH)
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            boundsList.push({
              x: c * sliceCellW,
              y: r * sliceCellH,
              w: sliceCellW,
              h: sliceCellH
            })
          }
        }
      } else {
        // Run BFS Pixel Island detection
        const { width, height } = img
        const imgData = ctx.getImageData(0, 0, width, height)
        const { data } = imgData
        const visited = new Uint8Array(width * height)

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x
            if (visited[idx]) continue
            const alpha = data[idx * 4 + 3]
            if (alpha > 4) {
              let minX = x, maxX = x, minY = y, maxY = y
              const queue: Array<[number, number]> = [[x, y]]
              visited[idx] = 1

              let qIdx = 0
              while (qIdx < queue.length) {
                const [cx, cy] = queue[qIdx++]
                const neighbors = [
                  [cx + 1, cy],
                  [cx - 1, cy],
                  [cx, cy + 1],
                  [cx, cy - 1]
                ]
                for (const [nx, ny] of neighbors) {
                  if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx
                    if (!visited[nidx]) {
                      const nalpha = data[nidx * 4 + 3]
                      if (nalpha > 4) {
                        visited[nidx] = 1
                        queue.push([nx, ny])
                        if (nx < minX) minX = nx
                        if (nx > maxX) maxX = nx
                        if (ny < minY) minY = ny
                        if (ny > maxY) maxY = ny
                      }
                    }
                  }
                }
              }

              const w = maxX - minX + 1
              const h = maxY - minY + 1
              if (w >= 2 && h >= 2) {
                boundsList.push({ x: minX, y: minY, w, h })
              }
            }
          }
        }
      }

      // Convert each slice to a base64 png
      const frames = boundsList.map((bounds, idx) => {
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = bounds.w
        sliceCanvas.height = bounds.h
        const sCtx = sliceCanvas.getContext('2d')
        if (sCtx) {
          sCtx.drawImage(
            img,
            bounds.x, bounds.y, bounds.w, bounds.h,
            0, 0, bounds.w, bounds.h
          )
        }
        return {
          index: idx + 1,
          bounds,
          dataUrl: sliceCanvas.toDataURL('image/png')
        }
      })

      // Redraw preview showing green bounding boxes
      ctx.clearRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)
      ctx.strokeStyle = '#00ff80'
      ctx.lineWidth = 1.5
      boundsList.forEach(b => {
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1)
      })

      setSlicedFrames(frames)
    } catch (err) {
      console.error(err)
      toast('Failed to slice sprite sheet.', { type: 'error' })
    } finally {
      setIsSlicerProcessing(false)
    }
  }, [slicerUrl, sliceMode, sliceCellW, sliceCellH, toast])

  const handleSlicerExport = useCallback(async () => {
    if (!slicerPath || slicedFrames.length === 0) return

    setIsSlicerSaving(true)
    try {
      const res = await window.electronAPI.gamedev.saveSlices({
        originalPath: slicerPath,
        files: slicedFrames
      })
      if (res.success) {
        toast(`Successfully sliced and saved ${res.count} frames!`, { type: 'success' })
        setSlicerExportedCount(res.count)
      } else {
        throw new Error(res.error || 'Failed to save')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsSlicerSaving(false)
    }
  }, [slicerPath, slicedFrames, toast])

  // Run whenever the image or slice parameters change. runSlicer is a no-op
  // when slicerUrl is null, so no activeTab guard is needed.
  useEffect(() => {
    runSlicer()
  }, [slicerUrl, sliceMode, sliceCellW, sliceCellH, runSlicer])

  // Tab 9: LUT Color Grader Callbacks
  const runLutUpdate = useCallback(() => {
    const canvas = lutPreviewCanvasRef.current
    if (!canvas) return

    canvas.width = 512
    canvas.height = 272
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 1. Build the colour grading LUT using the shared pure utility
    const d = buildLutData({
      exposure:    lutExposure,
      brightness:  lutBrightness,
      contrast:    lutContrast,
      saturation:  lutSaturation,
      temperature: lutTemperature
    })

    // Helper: Map an RGB triple through the pre-built LUT data buffer
    const applyLut = (r: number, g: number, b: number) => {
      const bBlock = Math.max(0, Math.min(15, Math.floor((b / 255) * 15)))
      const x     = Math.max(0, Math.min(15, Math.floor((r / 255) * 15)))
      const y     = Math.max(0, Math.min(15, Math.floor((g / 255) * 15)))
      const idx   = (y * 256 + (bBlock * 16 + x)) * 4
      return { r: d[idx], g: d[idx + 1], b: d[idx + 2] }
    }

    // 2. Draw Color Spectrum (Left half: 256×256)
    const specData = ctx.createImageData(256, 256)
    const sd = specData.data
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const graded = applyLut(x, y, 128)
        const i = (y * 256 + x) * 4
        sd[i] = graded.r; sd[i + 1] = graded.g; sd[i + 2] = graded.b; sd[i + 3] = 255
      }
    }
    ctx.putImageData(specData, 0, 0)

    // 3. Draw simple demo scene (Right half: 256×256)
    const demoCanvas = document.createElement('canvas')
    demoCanvas.width = 256
    demoCanvas.height = 256
    const dm = demoCanvas.getContext('2d')
    if (dm) {
      const sky = dm.createLinearGradient(0, 0, 0, 256)
      sky.addColorStop(0, '#f97316')
      sky.addColorStop(0.5, '#ec4899')
      sky.addColorStop(1, '#3b82f6')
      dm.fillStyle = sky
      dm.fillRect(0, 0, 256, 256)

      dm.beginPath()
      dm.arc(128, 110, 45, 0, Math.PI * 2)
      const sunGlow = dm.createLinearGradient(0, 65, 0, 155)
      sunGlow.addColorStop(0, '#fef08a')
      sunGlow.addColorStop(1, '#f97316')
      dm.fillStyle = sunGlow
      dm.fill()

      dm.fillStyle = '#1e1b4b'
      dm.beginPath()
      dm.moveTo(0, 256); dm.lineTo(80, 160); dm.lineTo(160, 256)
      dm.fill()

      dm.fillStyle = '#0f172a'
      dm.beginPath()
      dm.moveTo(100, 256); dm.lineTo(190, 140); dm.lineTo(256, 256)
      dm.fill()

      const demoImgData = dm.getImageData(0, 0, 256, 256)
      const dd = demoImgData.data
      for (let i = 0; i < dd.length; i += 4) {
        const graded = applyLut(dd[i], dd[i + 1], dd[i + 2])
        dd[i] = graded.r; dd[i + 1] = graded.g; dd[i + 2] = graded.b
      }
      ctx.putImageData(demoImgData, 256, 0)
    }

    // 4. Draw the LUT strip at the bottom centre
    const lutCanvas = document.createElement('canvas')
    lutCanvas.width = 256
    lutCanvas.height = 16
    const lCtx = lutCanvas.getContext('2d')
    if (lCtx) {
      lCtx.putImageData(new ImageData(d, 256, 16), 0, 0)
      ctx.drawImage(lutCanvas, 128, 256)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.strokeRect(127.5, 255.5, 257, 17)
    }
  }, [lutBrightness, lutContrast, lutSaturation, lutTemperature, lutExposure])

  const handleLutExport = useCallback(async () => {
    setIsLutSaving(true)
    try {
      // Re-use the shared utility, output is pixel-perfect identical to the preview
      const d = buildLutData({
        exposure:    lutExposure,
        brightness:  lutBrightness,
        contrast:    lutContrast,
        saturation:  lutSaturation,
        temperature: lutTemperature
      })

      const exportCanvas = document.createElement('canvas')
      exportCanvas.width = 256
      exportCanvas.height = 16
      exportCanvas.getContext('2d')!.putImageData(new ImageData(d, 256, 16), 0, 0)

      const base64Data = exportCanvas.toDataURL('image/png')
      // Anchor the export next to whichever asset is loaded in a sibling tool.
      // No silent fallback directory, exporting somewhere the user never
      // chose is worse than asking them to load an asset first.
      const basePath = slicerPath || seamlessPath || albedoPath || upscalePath
      if (!basePath) {
        toast('Load an image in any texture tool first, the LUT is saved next to that asset.', { type: 'warning' })
        return
      }

      const res = await window.electronAPI.gamedev.saveLut({ originalPath: basePath, dataUrl: base64Data })
      if (res.success) {
        toast('Color graded LUT strip successfully saved to asset directory!', { type: 'success' })
        setLutExportedPath(res.filePath || 'lut.png')
      } else {
        throw new Error(res.error || 'Failed to save')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export LUT Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsLutSaving(false)
    }
  }, [slicerPath, seamlessPath, albedoPath, upscalePath, lutBrightness, lutContrast, lutSaturation, lutTemperature, lutExposure, toast])

  useEffect(() => {
    if (activeTab === 'lut') {
      runLutUpdate()
    }
  }, [activeTab, runLutUpdate])

  // Tab 10: Pixel Art Upscaler Callbacks
  const handleSelectUpscaleFile = useCallback(async () => {
    try {
      const res = await window.electronAPI.gamedev.selectTexture()
      if (res) {
        setUpscalePath(res.path)
        setUpscaleUrl(res.dataUrl)
        setUpscaleExportedPath(null)
      }
    } catch (err) {
      console.error(err)
      toast('Failed to select upscale image.', { type: 'error' })
    }
  }, [toast])

  // Drag & drop a source image straight onto the upscaler viewport
  const handleUpscaleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Invalid File: Please drop an image file.', { type: 'error' })
      return
    }
    // Electron ≥32: File.path no longer exists, resolve via preload webUtils
    const path = window.electronAPI.app.getPathForFile(file)
    const reader = new FileReader()
    reader.onload = (event) => {
      setUpscalePath(path)
      setUpscaleUrl(event.target?.result as string)
      setUpscaleExportedPath(null)
      setUpscaleShowOriginal(false)
    }
    reader.readAsDataURL(file)
  }, [toast])

  // Persistent off-screen canvas holding the true upscale result. The export
  // path reads from here, so the before/after compare toggle can never
  // accidentally export the nearest-scaled original.
  const upscaleResultCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const runUpscale = useCallback(async () => {
    if (!upscaleUrl) return

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Image failed to decode'))
        image.src = upscaleUrl
      })

      const w = img.width
      const h = img.height

      // 1. Compute the upscaled result into the persistent off-screen canvas
      let result = upscaleResultCanvasRef.current
      if (!result) {
        result = document.createElement('canvas')
        upscaleResultCanvasRef.current = result
      }
      const rctx = result.getContext('2d')
      if (!rctx) return

      if (upscaleAlgorithm.startsWith('nearest')) {
        const factor = parseInt(upscaleAlgorithm.replace('nearest', '').replace('x', ''), 10) || 2
        result.width = w * factor
        result.height = h * factor
        rctx.imageSmoothingEnabled = false
        rctx.clearRect(0, 0, result.width, result.height)
        rctx.drawImage(img, 0, 0, result.width, result.height)
      } else {
        // EPX family, operate on the raw RGBA buffer via the shared pure cores
        const tmp = document.createElement('canvas')
        tmp.width = w
        tmp.height = h
        const tctx = tmp.getContext('2d')
        if (!tctx) return
        tctx.drawImage(img, 0, 0)
        // Copy once so the buffer is plain-ArrayBuffer-backed (matches what
        // the scaling cores return and what the ImageData constructor wants)
        let data = new Uint8ClampedArray(tctx.getImageData(0, 0, w, h).data)
        let ow = w
        let oh = h
        if (upscaleAlgorithm === 'scale2x') {
          data = scale2xData(data, ow, oh); ow *= 2; oh *= 2
        } else if (upscaleAlgorithm === 'scale3x') {
          data = scale3xData(data, ow, oh); ow *= 3; oh *= 3
        } else {
          // Scale4x (AdvMAME4x) = Scale2x applied twice
          data = scale2xData(data, ow, oh); ow *= 2; oh *= 2
          data = scale2xData(data, ow, oh); ow *= 2; oh *= 2
        }
        result.width = ow
        result.height = oh
        rctx.putImageData(new ImageData(data, ow, oh), 0, 0)
      }

      setUpscaleDims({ w, h, ow: result.width, oh: result.height })

      // 2. Blit either the result or the nearest-scaled original (compare
      //    mode) onto the visible canvas at the same output size.
      const canvas = upscalePreviewCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = result.width
      canvas.height = result.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (upscaleShowOriginal) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      } else {
        ctx.drawImage(result, 0, 0)
      }
    } catch (err) {
      console.error(err)
      toast('Failed to upscale texture.', { type: 'error' })
    }
  }, [upscaleUrl, upscaleAlgorithm, upscaleShowOriginal, toast])

  const handleUpscaleExport = useCallback(async () => {
    if (!upscalePath) return

    // Always export the computed result, never the compare-mode view
    const canvas = upscaleResultCanvasRef.current
    if (!canvas) return

    setIsUpscaleSaving(true)
    try {
      const base64Data = canvas.toDataURL('image/png')
      const res = await window.electronAPI.gamedev.saveUpscaled({
        originalPath: upscalePath,
        suffix: upscaleAlgorithm,
        dataUrl: base64Data
      })
      if (res.success) {
        toast('Upscaled texture saved next to original!', { type: 'success' })
        setUpscaleExportedPath(res.filePath || 'upscaled.png')
      } else {
        throw new Error(res.error || 'Failed to save')
      }
    } catch (err: any) {
      console.error(err)
      toast('Export Upscaled Error: ' + (err.message || String(err)), { type: 'error' })
    } finally {
      setIsUpscaleSaving(false)
    }
  }, [upscalePath, upscaleAlgorithm, toast])

  useEffect(() => {
    if (activeTab === 'upscaler') {
      runUpscale()
    }
  }, [upscaleUrl, upscaleAlgorithm, activeTab, runUpscale])

  // Watch albedo dataUrl changes and draw into canvases
  useEffect(() => {
    if (!albedoUrl) return

    const img = new Image()
    img.onload = () => {
      originalImageRef.current = img
      const size = 512

      const canvases = [
        albedoCanvasRef.current,
        heightCanvasRef.current,
        normalCanvasRef.current,
        roughnessCanvasRef.current,
        aoCanvasRef.current
      ]

      canvases.forEach(canvas => {
        if (canvas) {
          canvas.width = size
          canvas.height = size
        }
      })

      const albedoCanvas = albedoCanvasRef.current
      if (albedoCanvas) {
        const ctx = albedoCanvas.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0, size, size)
      }

      processTextures()
    }
    img.src = albedoUrl
  }, [albedoUrl, processTextures])

  // Triggers processTextures when sliders change or activeTab switches to PBR
  useEffect(() => {
    if (activeTab === 'pbr' && albedoUrl) {
      if (originalImageRef.current) {
        const size = 512
        const canvases = [
          albedoCanvasRef.current,
          heightCanvasRef.current,
          normalCanvasRef.current,
          roughnessCanvasRef.current,
          aoCanvasRef.current
        ]
        canvases.forEach(canvas => {
          if (canvas) {
            canvas.width = size
            canvas.height = size
          }
        })
        const albedoCanvas = albedoCanvasRef.current
        if (albedoCanvas) {
          const ctx = albedoCanvas.getContext('2d')
          if (ctx) ctx.drawImage(originalImageRef.current, 0, 0, size, size)
        }
      }
      processTextures()
    }
  }, [normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, albedoUrl, activeTab, processTextures])

  // ThreeJS texture refs
  const threeTexturesRef = useRef<{
    map: THREE.CanvasTexture | null;
    normalMap: THREE.CanvasTexture | null;
    bumpMap: THREE.CanvasTexture | null;
    roughnessMap: THREE.CanvasTexture | null;
    aoMap: THREE.CanvasTexture | null;
  }>({
    map: null,
    normalMap: null,
    bumpMap: null,
    roughnessMap: null,
    aoMap: null
  })

  const threeSceneRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    mesh: THREE.Mesh | null;
    material: THREE.MeshStandardMaterial | null;
  }>({
    renderer: null,
    mesh: null,
    material: null
  })

  // ThreeJS initialization and loop
  useEffect(() => {
    if (activeTab !== 'pbr') return
    const canvas = previewCanvasRef.current
    if (!canvas) return

    const width = 328
    const height = 300

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.z = 2.4

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    threeSceneRef.current.renderer = renderer

    const albedoCanvas = albedoCanvasRef.current
    const heightCanvas = heightCanvasRef.current
    const normalCanvas = normalCanvasRef.current
    const roughnessCanvas = roughnessCanvasRef.current
    const aoCanvas = aoCanvasRef.current

    let map: THREE.CanvasTexture | null = null
    let normalMap: THREE.CanvasTexture | null = null
    let bumpMap: THREE.CanvasTexture | null = null
    let roughnessMap: THREE.CanvasTexture | null = null
    let aoMap: THREE.CanvasTexture | null = null

    if (albedoCanvas) {
      map = new THREE.CanvasTexture(albedoCanvas)
      threeTexturesRef.current.map = map
    }
    if (normalCanvas) {
      normalMap = new THREE.CanvasTexture(normalCanvas)
      threeTexturesRef.current.normalMap = normalMap
    }
    if (heightCanvas) {
      bumpMap = new THREE.CanvasTexture(heightCanvas)
      threeTexturesRef.current.bumpMap = bumpMap
    }
    if (roughnessCanvas) {
      roughnessMap = new THREE.CanvasTexture(roughnessCanvas)
      threeTexturesRef.current.roughnessMap = roughnessMap
    }
    if (aoCanvas) {
      aoMap = new THREE.CanvasTexture(aoCanvas)
      threeTexturesRef.current.aoMap = aoMap
    }

    const material = new THREE.MeshStandardMaterial({
      map: map,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      bumpMap: bumpMap,
      bumpScale: 0.08,
      roughnessMap: roughnessMap,
      aoMap: aoMap,
      metalness: 0.05,
      side: THREE.DoubleSide // keeps the plane visible from behind while rotating
    })
    threeSceneRef.current.material = material

    let geometry: THREE.BufferGeometry
    if (shape === 'cube') {
      geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9)
    } else if (shape === 'plane') {
      geometry = new THREE.PlaneGeometry(1.35, 1.35)
    } else {
      geometry = new THREE.SphereGeometry(0.65, 64, 64)
    }

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    threeSceneRef.current.mesh = mesh

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const pointLight = new THREE.PointLight(0xffffff, 1.8, 100)
    pointLight.position.set(2, 2, 2)
    scene.add(pointLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(-2, 1, 2)
    scene.add(dirLight)

    let animationFrameId: number
    let angle = 0

    const animate = () => {
      if (rotate) {
        mesh.rotation.y += 0.005
        mesh.rotation.x += 0.002
      }

      angle += 0.015
      pointLight.position.x = Math.cos(angle) * 2
      pointLight.position.z = Math.sin(angle) * 2

      renderer.render(scene, camera)
      animationFrameId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationFrameId)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      if (map) map.dispose()
      if (normalMap) normalMap.dispose()
      if (bumpMap) bumpMap.dispose()
      if (roughnessMap) roughnessMap.dispose()
      if (aoMap) aoMap.dispose()

      threeTexturesRef.current = {
        map: null,
        normalMap: null,
        bumpMap: null,
        roughnessMap: null,
        aoMap: null
      }
      threeSceneRef.current = {
        renderer: null,
        mesh: null,
        material: null
      }
    }
  }, [activeTab, shape, rotate])

  const getNewName = useCallback((oldName: string, index: number) => {
    const lastDot = oldName.lastIndexOf('.')
    const ext = lastDot !== -1 ? oldName.substring(lastDot) : ''
    let base = lastDot !== -1 ? oldName.substring(0, lastDot) : oldName

    // 1. Presets (Unity / Unreal prefixes)
    if (renamerPreset === 'texture') {
      base = 'T_' + base
    } else if (renamerPreset === 'mesh') {
      base = 'SM_' + base
    } else if (renamerPreset === 'audio') {
      base = 'A_' + base
    }

    // 2. Suffix presets
    if (renamerSuffixPreset === 'diffuse') {
      base = base + '_D'
    } else if (renamerSuffixPreset === 'normal') {
      base = base + '_N'
    }

    // 3. Search & Replace
    if (searchStr) {
      base = base.replaceAll(searchStr, replaceStr)
    }

    // 4. Custom Prefix / Suffix
    if (customPrefix) {
      base = customPrefix + base
    }
    if (customSuffix) {
      base = base + customSuffix
    }

    // 5. Automatic Number Indexing
    if (enableIndexing) {
      const paddedNum = String(index + startIndex).padStart(indexPadding, '0')
      base = base + '_' + paddedNum
    }

    return base + ext
  }, [renamerPreset, renamerSuffixPreset, searchStr, replaceStr, customPrefix, customSuffix, enableIndexing, startIndex, indexPadding])

  // Drag & Drop Event Handlers (stable useCallback refs)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      // Electron ≥32: File.path no longer exists, resolve via preload webUtils
      const dropped = Array.from(e.dataTransfer.files).map(f => ({
        name: f.name,
        path: window.electronAPI.app.getPathForFile(f),
        status: 'pending' as const
      })).filter(f => f.path !== '')
      setFiles(prev => [...prev, ...dropped])
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).map(f => ({
        name: f.name,
        path: window.electronAPI.app.getPathForFile(f),
        status: 'pending' as const
      })).filter(f => f.path !== '')
      setFiles(prev => [...prev, ...selected])
    }
  }, [])

  const handleApplyRename = useCallback(async () => {
    if (files.length === 0) return
    setRenaming(true)
    const list = files.map((f, idx) => {
      const newName = getNewName(f.name, idx)
      const platform = window.electronAPI.app.platform
      const separator = platform === 'win32' ? '\\' : '/'
      const lastSep = f.path.lastIndexOf(separator)
      const dir = lastSep !== -1 ? f.path.substring(0, lastSep) : ''
      const newPath = dir ? dir + separator + newName : newName
      return { oldPath: f.path, newPath }
    })

    try {
      const res = await window.electronAPI.gamedev.batchRename(list)
      if (res.success) {
        toast(`Successfully renamed ${res.renamedCount} assets!`, { type: 'success' })
        setFiles([])
      } else {
        toast(`Errors occurred during renaming.`, { type: 'error' })
        setFiles(prev => prev.map(f => {
          const matchErr = res.errors.find(e => e.oldPath === f.path)
          if (matchErr) {
            return { ...f, status: 'error', error: matchErr.error }
          }
          return { ...f, status: 'success' }
        }))
      }
    } catch (err) {
      console.error(err)
      toast('Failed to apply rename operations.', { type: 'error' })
    } finally {
      setRenaming(false)
    }
  }, [files, getNewName, toast])

  // Tab 3: Dialogue Editor Logic
  const addDialogueNode = useCallback(() => {
    if (!nodeId) {
      toast('Node ID is required', { type: 'info' })
      return
    }
    if (dialogueNodes.some(n => n.id === nodeId)) {
      toast('Node ID must be unique', { type: 'info' })
      return
    }
    setDialogueNodes(prev => [...prev, {
      id: nodeId,
      speaker: nodeSpeaker || 'Narrator',
      text: nodeText || '',
      choices: []
    }])
    setNodeId('')
    setNodeSpeaker('')
    setNodeText('')
    toast('Dialogue node created!', { type: 'success' })
  }, [nodeId, dialogueNodes, nodeSpeaker, nodeText, toast])

  const removeDialogueNode = useCallback((id: string) => {
    setDialogueNodes(prev => prev.filter(n => n.id !== id))
  }, [])

  const addChoiceToNode = useCallback((nodeIndex: number, text: string, nextId: string) => {
    if (!text || !nextId) return
    setDialogueNodes(prev => {
      const copy = [...prev]
      copy[nodeIndex] = {
        ...copy[nodeIndex],
        choices: [...copy[nodeIndex].choices, { text, nextId }]
      }
      return copy
    })
  }, [])

  const removeChoiceFromNode = useCallback((nodeIndex: number, choiceIndex: number) => {
    setDialogueNodes(prev => {
      const copy = [...prev]
      const updatedChoices = [...copy[nodeIndex].choices]
      updatedChoices.splice(choiceIndex, 1)
      copy[nodeIndex] = {
        ...copy[nodeIndex],
        choices: updatedChoices
      }
      return copy
    })
  }, [])

  const compiledMermaid = useMemo(() => {
    let code = 'graph TD\n'
    code += '  %% Theme configurations\n'
    code += '  classDef default fill:#1b1f30,stroke:#24293f,color:#f1f5f9;\n'
    code += '  classDef root fill:#202510,stroke:#cdf12b,color:#cdf12b;\n\n'

    dialogueNodes.forEach(node => {
      const label = `"${node.speaker || 'Narrator'}:\\n${(node.text || '').replace(/"/g, "'")}"`
      code += `  ${node.id}[${label}]\n`
      if (node.id === 'start') {
        code += `  class ${node.id} root;\n`
      }
      node.choices.forEach(c => {
        const choiceText = c.text ? `|"${c.text.replace(/"/g, "'")}"|` : ''
        code += `  ${node.id} -->${choiceText} ${c.nextId}\n`
      })
    })
    return code
  }, [dialogueNodes])

  // Tab 4: Palette Exporter Logic
  const addColorToPalette = useCallback(() => {
    if (!paletteColors.includes(newColor)) {
      setPaletteColors(prev => [...prev, newColor])
    }
  }, [paletteColors, newColor])

  const removeColorFromPalette = useCallback((col: string) => {
    setPaletteColors(prev => prev.filter(c => c !== col))
  }, [])

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast(`Copied ${label} snippet to clipboard`, { type: 'success' })
  }, [toast])

  // useMemo so the generated strings are only recomputed when the palette changes
  const generatedUnityColor = useMemo(() =>
    paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `new Color(${r}f, ${g}f, ${b}f, 1.0f)`
    }).join(',\n  ')
  , [paletteColors])

  const generatedUnrealColor = useMemo(() =>
    paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `FLinearColor(${r}f, ${g}f, ${b}f, 1.0f)`
    }).join(',\n  ')
  , [paletteColors])

  const generatedHlslColor = useMemo(() => {
    const list = paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `float4(${r}, ${g}, ${b}, 1.0)`
    }).join(', ')
    return `static const float4 ColorPalette[${paletteColors.length}] = {\n  ${list}\n};`
  }, [paletteColors])

  return (
    <div style={{
      padding: 'var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      overflowY: 'auto',
      height: '100%',
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-text-base)',
      fontFamily: 'var(--font-sans)',
      boxSizing: 'border-box'
    }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)' }}>
          Game Development Workspace
        </h2>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Texture authoring, sprite pipeline and narrative tools, all processing runs locally.
        </p>
      </div>

      {/* Grouped tool navigation */}
      <style>{`
        .gamedev-tab-btn {
          background: transparent;
          border: 1px solid transparent;
          color: var(--color-text-muted);
          font-size: var(--text-xs);
          font-weight: var(--weight-medium);
          padding: 7px 13px;
          border-radius: var(--radius-md);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          white-space: nowrap;
          transition: all 120ms ease;
        }
        .gamedev-tab-btn:hover {
          background: var(--color-surface-2);
          color: var(--color-text-base);
        }
        .gamedev-tab-btn.active {
          background: var(--color-secondary-muted);
          color: var(--color-secondary);
          border-color: var(--color-secondary);
          font-weight: var(--weight-semibold);
          box-shadow: var(--shadow-sm);
        }
        .gamedev-info-banner {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          padding: 12px 16px;
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          font-size: var(--text-xs);
          line-height: 1.5;
          color: var(--color-text-muted);
          margin-bottom: var(--space-4);
        }
        .gamedev-info-banner strong {
          color: var(--color-text-base);
          font-weight: var(--weight-semibold);
        }
        .gamedev-info-banner-icon {
          color: var(--color-secondary);
          flex-shrink: 0;
          margin-top: 2px;
        }
      `}</style>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {([
          {
            group: 'Textures',
            tools: [
              { id: 'pbr' as const,      label: 'PBR Maps',       icon: <Sparkles size={14} /> },
              { id: 'seamless' as const, label: 'Seamless Tiler', icon: <Repeat size={14} /> },
              { id: 'upscaler' as const, label: 'Pixel Upscaler', icon: <Maximize2 size={14} /> },
              { id: 'lut' as const,      label: 'LUT Grader',     icon: <Sliders size={14} /> }
            ]
          },
          {
            group: 'Sprites',
            tools: [
              { id: 'atlas' as const,  label: 'Atlas Packer',  icon: <Grid size={14} /> },
              { id: 'slicer' as const, label: 'Sprite Slicer', icon: <Scissors size={14} /> }
            ]
          },
          {
            group: 'Pipeline',
            tools: [
              { id: 'renamer' as const,  label: 'Batch Renamer',  icon: <Layers size={14} /> },
              { id: 'dialogue' as const, label: 'Dialogue Flow',  icon: <GitFork size={14} /> },
              { id: 'palette' as const,  label: 'Shader Palette', icon: <Palette size={14} /> }
            ]
          },
          {
            group: 'Level Design',
            tools: [
              { id: 'mapmaker' as const, label: 'Map Maker', icon: <Map size={14} /> }
            ]
          }
        ]).map(section => (
          <div
            key={section.group}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: '6px 8px 8px'
            }}
          >
            <span style={{
              fontSize: '9px',
              fontWeight: 'var(--weight-bold)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--color-text-faint)',
              padding: '0 6px'
            }}>
              {section.group}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {section.tools.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => setActiveTab(tool.id)}
                  className={`gamedev-tab-btn ${activeTab === tool.id ? 'active' : ''}`}
                >
                  {tool.icon}
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tab Panels */}
      <div style={{ flex: 1, minHeight: 0 }}>
        
        {/* TAB 1: BATCH ASSET RENAMER */}
        {activeTab === 'renamer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Info size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Batch Asset Renamer:</strong> Standardize your file naming workflow. Import textures, models, or audio assets to apply game engine naming conventions, search-and-replace strings, or automatic number indexing.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
              
              {/* Settings Card */}
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)'
              }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Naming Conventions</h3>
                
                {/* Preset Row */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Asset Type Prefix (Unity/Unreal)</label>
                  <select
                    value={renamerPreset}
                    onChange={e => setRenamerPreset(e.target.value as any)}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)'
                    }}
                  >
                    <option value="none">No Preset Prefix</option>
                    <option value="texture">Texture (T_)</option>
                    <option value="mesh">Static Mesh (SM_)</option>
                    <option value="audio">Audio (A_)</option>
                  </select>
                </div>

                {/* Suffix Preset */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Texture Map Suffix</label>
                  <select
                    value={renamerSuffixPreset}
                    onChange={e => setRenamerSuffixPreset(e.target.value as any)}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)'
                    }}
                  >
                    <option value="none">No Preset Suffix</option>
                    <option value="diffuse">Diffuse (_D)</option>
                    <option value="normal">Normal map (_N)</option>
                  </select>
                </div>

                {/* Custom Prefix & Suffix */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Custom Prefix</label>
                    <input
                      type="text"
                      value={customPrefix}
                      onChange={e => setCustomPrefix(e.target.value)}
                      placeholder="e.g. Env_"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-2)',
                        fontSize: 'var(--text-xs)'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Custom Suffix</label>
                    <input
                      type="text"
                      value={customSuffix}
                      onChange={e => setCustomSuffix(e.target.value)}
                      placeholder="e.g. _low"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-2)',
                        fontSize: 'var(--text-xs)'
                      }}
                    />
                  </div>
                </div>

                {/* Search and Replace */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Search For</label>
                    <input
                      type="text"
                      value={searchStr}
                      onChange={e => setSearchStr(e.target.value)}
                      placeholder="e.g. temp"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-2)',
                        fontSize: 'var(--text-xs)'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Replace With</label>
                    <input
                      type="text"
                      value={replaceStr}
                      onChange={e => setReplaceStr(e.target.value)}
                      placeholder="e.g. final"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)',
                        padding: 'var(--space-2)',
                        fontSize: 'var(--text-xs)'
                      }}
                    />
                  </div>
                </div>

                {/* Auto Number Indexing */}
                <div style={{
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2.5)',
                  background: 'var(--color-surface-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={enableIndexing}
                      onChange={e => setEnableIndexing(e.target.checked)}
                    />
                    <span>Automatic Number Indexing</span>
                  </label>
                  {enableIndexing && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginTop: '2px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Start Index</label>
                        <input
                          type="number"
                          value={startIndex}
                          onChange={e => setStartIndex(Math.max(0, parseInt(e.target.value) || 0))}
                          style={{
                            background: 'var(--color-surface-1)',
                            border: '1px solid var(--color-surface-offset)',
                            color: 'var(--color-text-base)',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            fontSize: '11px'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Digits Padding</label>
                        <input
                          type="number"
                          value={indexPadding}
                          onChange={e => setIndexPadding(Math.max(1, parseInt(e.target.value) || 2))}
                          style={{
                            background: 'var(--color-surface-1)',
                            border: '1px solid var(--color-surface-offset)',
                            color: 'var(--color-text-base)',
                            borderRadius: '4px',
                            padding: '4px 6px',
                            fontSize: '11px'
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Drag Zone Card */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{
                  background: isDragOver ? 'var(--color-primary-muted)' : 'var(--color-surface-1)',
                  border: isDragOver ? '2px dashed var(--color-secondary)' : '2px dashed var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '220px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 150ms ease'
                }}
                onClick={() => document.getElementById('renamer-file-picker')?.click()}
              >
                <input
                  type="file"
                  id="renamer-file-picker"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                <Layers size={36} style={{ color: isDragOver ? 'var(--color-secondary)' : 'var(--color-text-faint)', marginBottom: 'var(--space-2)' }} />
                <h4 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                  Drag & Drop Game Assets Here
                </h4>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: '240px', lineHeight: 1.5 }}>
                  Supports models, textures, sound clips. Paths will load securely into preview.
                </p>
                <span style={{ display: 'inline-block', marginTop: 'var(--space-3)', background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: '11px', fontWeight: 'var(--weight-medium)' }}>
                  Browse Local Files
                </span>
              </div>
            </div>

            {/* Preview List */}
            {files.length > 0 && (
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: '200px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>Renaming Preview ({files.length} items)</span>
                    <button
                      onClick={() => setFiles([])}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-error)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center'
                      }}
                      title="Clear Files"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <button
                    onClick={handleApplyRename}
                    disabled={renaming}
                    style={{
                      background: 'var(--color-secondary)',
                      color: 'white',
                      border: 'none',
                      padding: 'var(--space-1.5) var(--space-4)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1-5)',
                      opacity: renaming ? 0.6 : 1
                    }}
                  >
                    <RefreshCw size={12} className={renaming ? 'spin' : ''} />
                    <span>Apply Batch Rename</span>
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '300px' }}>
                  {files.map((file, idx) => {
                    const newName = getNewName(file.name, idx)
                    const isChanged = newName !== file.name
                    return (
                      <div key={idx} style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto 1fr',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-2)',
                        background: 'var(--color-surface-2)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)'
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }} title={file.path}>
                          {file.name}
                        </span>
                        <span style={{ color: 'var(--color-text-faint)' }}>➔</span>
                        <span style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: isChanged ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                          color: isChanged ? 'var(--color-secondary)' : 'var(--color-text-base)'
                        }}>
                          {newName}
                          {file.status === 'success' && <CheckCircle size={12} style={{ color: 'var(--color-success)', marginLeft: '6px', display: 'inline' }} />}
                          {file.status === 'error' && (
                            <span style={{ color: 'var(--color-error)', marginLeft: '6px', fontSize: '10px' }} title={file.error}>
                              ⚠ Fail
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DIALOGUE & QUEST TREE BUILDER */}
        {activeTab === 'dialogue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="gamedev-info-banner">
              <Info size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Dialogue & Quest Tree Builder:</strong> Structure branching narrative decisions and interactive flows. Export your quest nodes instantly as a standard Mermaid flowchart.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-4)' }}>
            
            {/* Editor Console */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)'
            }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Add Dialogue Node</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Unique Node ID</label>
                  <input
                    type="text"
                    value={nodeId}
                    onChange={e => setNodeId(e.target.value)}
                    placeholder="e.g. quest_decline"
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Speaker Name</label>
                  <input
                    type="text"
                    value={nodeSpeaker}
                    onChange={e => setNodeSpeaker(e.target.value)}
                    placeholder="e.g. Hero"
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>Dialogue Line</label>
                <textarea
                  value={nodeText}
                  onChange={e => setNodeText(e.target.value)}
                  placeholder="e.g. I must find another path..."
                  rows={2}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    resize: 'none',
                    fontFamily: 'inherit'
                  }}
                />
              </div>

              <button
                onClick={addDialogueNode}
                style={{
                  background: 'var(--color-secondary)',
                  color: 'white',
                  border: 'none',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-1.5)'
                }}
              >
                <Plus size={14} />
                <span>Create Dialogue Node</span>
              </button>

              <hr style={{ border: '0', borderTop: '1px solid var(--color-surface-offset)', margin: 'var(--space-2) 0' }} />

              <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', margin: '0 0 var(--space-2)' }}>Branching Connections</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto', maxHeight: '180px' }}>
                {dialogueNodes.map((node, nodeIdx) => (
                  <div key={node.id} style={{
                    padding: 'var(--space-2)',
                    background: 'var(--color-surface-2)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 'var(--text-xs)', color: 'var(--color-secondary)' }}>
                        {node.id} ({node.speaker})
                      </strong>
                      <button
                        onClick={() => removeDialogueNode(node.id)}
                        disabled={node.id === 'start'}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-error)',
                          cursor: 'pointer',
                          opacity: node.id === 'start' ? 0.3 : 1
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      &ldquo;{node.text}&rdquo;
                    </div>
                    
                    {/* Active Choices list */}
                    {node.choices.map((c, choiceIdx) => (
                      <div key={choiceIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', background: 'var(--color-surface-1)', padding: '2px 6px', borderRadius: '4px', marginTop: '2px' }}>
                        <span>choice: <strong>{c.text}</strong> ➔ {c.nextId}</span>
                        <button
                          onClick={() => removeChoiceFromNode(nodeIdx, choiceIdx)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    {/* Add Choice Form */}
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                      <input
                        type="text"
                        placeholder="Choice text"
                        value={dialogueChoiceInputs[node.id]?.text || ''}
                        onChange={e => setDialogueChoiceInputs(prev => ({
                          ...prev,
                          [node.id]: {
                            text: e.target.value,
                            nextId: prev[node.id]?.nextId || ''
                          }
                        }))}
                        style={{
                          flex: 1,
                          background: 'var(--color-surface-1)',
                          border: '1px solid var(--color-surface-offset)',
                          color: 'var(--color-text-base)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '10px'
                        }}
                      />
                      <select
                        value={dialogueChoiceInputs[node.id]?.nextId || ''}
                        onChange={e => setDialogueChoiceInputs(prev => ({
                          ...prev,
                          [node.id]: {
                            text: prev[node.id]?.text || '',
                            nextId: e.target.value
                          }
                        }))}
                        style={{
                          flex: 1,
                          background: 'var(--color-surface-1)',
                          border: '1px solid var(--color-surface-offset)',
                          color: 'var(--color-text-base)',
                          borderRadius: '4px',
                          padding: '2px',
                          fontSize: '10px'
                        }}
                      >
                        <option value="">Next Node</option>
                        {dialogueNodes.map(opt => (
                          opt.id !== node.id && <option key={opt.id} value={opt.id}>{opt.id}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          const inputVal = dialogueChoiceInputs[node.id]
                          if (inputVal && inputVal.text && inputVal.nextId) {
                            addChoiceToNode(nodeIdx, inputVal.text, inputVal.nextId)
                            setDialogueChoiceInputs(prev => ({
                              ...prev,
                              [node.id]: { text: '', nextId: '' }
                            }))
                          }
                        }}
                        style={{
                          background: 'var(--color-surface-offset)',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'var(--color-text-base)',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: '10px'
                        }}
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Compiled Mermaid Output */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Dialogue Graph</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', gap: '2px', background: 'var(--color-surface-2)', padding: '2px', borderRadius: '6px', border: '1px solid var(--color-surface-offset)' }}>
                    <button
                      onClick={() => setDialogueViewMode('visual')}
                      style={{
                        background: dialogueViewMode === 'visual' ? 'var(--color-secondary-muted)' : 'transparent',
                        color: dialogueViewMode === 'visual' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer',
                        transition: 'all 120ms ease'
                      }}
                    >
                      Visual Chart
                    </button>
                    <button
                      onClick={() => setDialogueViewMode('code')}
                      style={{
                        background: dialogueViewMode === 'code' ? 'var(--color-secondary-muted)' : 'transparent',
                        color: dialogueViewMode === 'code' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer',
                        transition: 'all 120ms ease'
                      }}
                    >
                      Mermaid Code
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(compiledMermaid, 'Mermaid Flowchart')}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Copy size={10} />
                    <span>Copy Code</span>
                  </button>
                </div>
              </div>

              {dialogueViewMode === 'visual' ? (
                <MermaidChart code={compiledMermaid} />
              ) : (
                <pre style={{
                  margin: 0,
                  padding: 'var(--space-3)',
                  background: 'var(--color-background)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-base)',
                  flex: 1,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '340px',
                  border: '1px solid var(--color-surface-offset)'
                }}>
                  {compiledMermaid}
                </pre>
              )}
            </div>
          </div>
          </div>
        )}

        {/* TAB 4: SHADER PALETTE CODE GENERATOR */}
        {activeTab === 'palette' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="gamedev-info-banner">
              <Info size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Shader Palette & Code Generator:</strong> Build clean color schemes and immediately generate array codes for Unity C#, Unreal Engine C++, or HLSL pixel shaders.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-4)' }}>
            
            {/* Color picker list */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)'
            }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Color Palette Creator</h3>
              
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <ColorPicker
                  value={newColor}
                  onCommit={setNewColor}
                  swatchSize={32}
                  hexInputWidth={100}
                  title="Select Palette Color"
                />
                <button
                  onClick={addColorToPalette}
                  style={{
                    background: 'var(--color-secondary)',
                    color: 'white',
                    border: 'none',
                    padding: 'var(--space-1.5) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-semibold)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={14} />
                  <span>Add Color</span>
                </button>
              </div>

              {/* Grid of colors */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {paletteColors.map((col) => (
                  <div
                    key={col}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      position: 'relative'
                    }}
                  >
                    <div style={{
                      width: '100%',
                      height: '36px',
                      background: col,
                      borderRadius: '4px',
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                    }} />
                    <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', marginTop: '4px', color: 'var(--color-text-muted)' }}>
                      {col.toUpperCase()}
                    </span>
                    <button
                      onClick={() => removeColorFromPalette(col)}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        right: '2px',
                        background: 'rgba(0,0,0,0.5)',
                        border: 'none',
                        color: 'white',
                        borderRadius: '50%',
                        width: '14px',
                        height: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        cursor: 'pointer'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Generated Code Snippets */}
            <div style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)'
            }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', margin: 0 }}>Shader & Code Snippets</h3>
              
              {/* Unity Code Block */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>Unity C# Color Array</span>
                  <button
                    onClick={() => copyToClipboard(`public Color[] palette = new Color[] {\n  ${generatedUnityColor}\n};`, 'Unity C#')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
                  >
                    <Copy size={10} /> Copy
                  </button>
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {`public Color[] palette = new Color[] {\n  ${generatedUnityColor.substring(0, 80)}...\n};`}
                </pre>
              </div>

              {/* Unreal Code Block */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>Unreal Engine C++ FLinearColor</span>
                  <button
                    onClick={() => copyToClipboard(`TArray<FLinearColor> Palette = {\n  ${generatedUnrealColor}\n};`, 'Unreal C++')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
                  >
                    <Copy size={10} /> Copy
                  </button>
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {`TArray<FLinearColor> Palette = {\n  ${generatedUnrealColor.substring(0, 80)}...\n};`}
                </pre>
              </div>

              {/* HLSL Code Block */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-semibold)' }}>HLSL float4 Shader Array</span>
                  <button
                    onClick={() => copyToClipboard(generatedHlslColor, 'HLSL float4')}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px' }}
                  >
                    <Copy size={10} /> Copy
                  </button>
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', fontSize: '10px', color: 'var(--color-text-muted)', overflowX: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {generatedHlslColor.substring(0, 100) + '...'}
                </pre>
              </div>
            </div>
          </div>
          </div>
        )}

        {/* TAB 5: PBR MAP GENERATOR */}
        {activeTab === 'pbr' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Sparkles size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>PBR Map Generator:</strong> Drag and drop a flat Albedo texture to automatically estimate and generate corresponding Normal, Height, Roughness, and Ambient Occlusion (AO) maps. Tweak parameters and preview in real time on a 3D model.
              </div>
            </div>

            {!albedoUrl ? (
              /* Drop Zone */
              <div
                onDragOver={handlePbrDragOver}
                onDrop={handlePbrDrop}
                onClick={handleBrowseClick}
                style={{
                  flex: 1,
                  minHeight: '300px',
                  border: '2px dashed var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-4)',
                  cursor: 'pointer',
                  background: 'var(--color-surface-1)',
                  transition: 'border-color var(--duration-fast), background var(--duration-fast)',
                }}
                onMouseOver={e => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)'
                  e.currentTarget.style.background = 'var(--color-surface-2)'
                }}
                onMouseOut={e => {
                  e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                  e.currentTarget.style.background = 'var(--color-surface-1)'
                }}
              >
                {isProcessing ? (
                  <>
                    <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Processing texture...</span>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-surface-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--color-surface-offset)'
                    }}>
                      <Download size={24} style={{ color: 'var(--color-text-muted)', transform: 'rotate(180deg)' }} />
                    </div>
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                        Drag & Drop Albedo Texture
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        or click to browse local files (.png, .jpg, .jpeg, .tga, .bmp)
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Generator Workspace */
              <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
                
                {/* Left Column: 3D Preview & Sliders */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  overflowY: 'auto'
                }}>
                  {/* ThreeJS Container */}
                  <div style={{ position: 'relative', width: '100%', height: '300px', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-surface-offset)' }}>
                    <canvas ref={previewCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                    
                    {/* Floating Controls */}
                    <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setShape(prev => prev === 'sphere' ? 'cube' : prev === 'cube' ? 'plane' : 'sphere')}
                        title="Cycle preview mesh: sphere → cube → plane"
                        style={{
                          background: 'rgba(19, 22, 34, 0.8)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-base)',
                          padding: '4px 8px',
                          fontSize: '10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          backdropFilter: 'blur(4px)'
                        }}
                      >
                        <Box size={10} />
                        <span style={{ textTransform: 'capitalize' }}>{shape}</span>
                      </button>
                      
                      <button
                        onClick={() => setRotate(prev => !prev)}
                        style={{
                          background: 'rgba(19, 22, 34, 0.8)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: rotate ? 'var(--color-secondary)' : 'var(--color-text-base)',
                          padding: '4px 8px',
                          fontSize: '10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          backdropFilter: 'blur(4px)'
                        }}
                      >
                        <RefreshCw size={10} className={rotate ? 'animate-spin' : ''} />
                        <span>Rotation</span>
                      </button>
                    </div>
                  </div>

                  {/* Sliders Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                    <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                    <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                      Map Generation Tweak Settings
                    </span>
                  </div>

                  {/* Sliders Container */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* Invert height, dark pixels read as crevices vs. ridges */}
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Invert Height</span>
                        <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>Treat dark pixels as raised instead of recessed</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={invertHeight}
                        onChange={e => setInvertHeight(e.target.checked)}
                        style={{ accentColor: 'var(--color-secondary)' }}
                      />
                    </label>

                    {/* Normal Intensity */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Normal Intensity</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{normalIntensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="10.0"
                        step="0.1"
                        value={normalIntensity}
                        onChange={e => setNormalIntensity(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>

                    {/* Height Depth */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Height/Bump Depth</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{heightDepth.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="5.0"
                        step="0.05"
                        value={heightDepth}
                        onChange={e => setHeightDepth(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>

                    {/* Roughness Contrast */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Roughness Contrast</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{roughnessContrast.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="3.0"
                        step="0.1"
                        value={roughnessContrast}
                        onChange={e => setRoughnessContrast(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>

                    {/* Roughness Base */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Roughness Base (Shininess)</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{roughnessBase.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.05"
                        value={roughnessBase}
                        onChange={e => setRoughnessBase(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>

                    {/* AO Intensity */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>AO Crevice Darkness</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{aoIntensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="5.0"
                        step="0.1"
                        value={aoIntensity}
                        onChange={e => setAoIntensity(parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column: 2D Grid & Export Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                  
                  {/* File Metadata Header */}
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3) var(--space-4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Active Albedo File:</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={albedoPath || ''}>
                        {albedoPath ? albedoPath.split(/[\\/]/).pop() : 'Direct Memory'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        onClick={handleBrowseClick}
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-base)',
                          fontSize: '11px',
                          padding: '6px 12px',
                          cursor: 'pointer'
                        }}
                      >
                        Change Texture
                      </button>
                      <button
                        onClick={() => {
                          setAlbedoUrl(null)
                          setAlbedoPath(null)
                          setExportedFiles([])
                          useAppStore.getState().setGamedevPreloadTexture(null, null)
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-error-muted)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-error)',
                          fontSize: '11px',
                          padding: '6px 12px',
                          cursor: 'pointer'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* 2D Previews Grid */}
                  <div style={{
                    flex: 1,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 'var(--space-3)',
                    overflowY: 'auto'
                  }}>
                    
                    {/* Albedo Thumbnail */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Albedo (Base Color)</span>
                      <div style={{ flex: 1, minHeight: '160px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <img src={albedoUrl || undefined} style={{ maxWidth: '100%', maxHeight: '160px', objectFit: 'contain' }} alt="Albedo" />
                      </div>
                    </div>

                    {/* Normal Map Thumbnail */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Normal Map</span>
                      <div style={{ flex: 1, minHeight: '160px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <canvas ref={normalCanvasRef} style={{ maxWidth: '100%', maxHeight: '160px', display: 'block', objectFit: 'contain' }} />
                      </div>
                    </div>

                    {/* Height Map Thumbnail */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Height Map (Displacement)</span>
                      <div style={{ flex: 1, minHeight: '160px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <canvas ref={heightCanvasRef} style={{ maxWidth: '100%', maxHeight: '160px', display: 'block', objectFit: 'contain' }} />
                      </div>
                    </div>

                    {/* Roughness Map Thumbnail */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Roughness Map</span>
                      <div style={{ flex: 1, minHeight: '160px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <canvas ref={roughnessCanvasRef} style={{ maxWidth: '100%', maxHeight: '160px', display: 'block', objectFit: 'contain' }} />
                      </div>
                    </div>

                    {/* AO Map Thumbnail */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Ambient Occlusion (AO)</span>
                      <div style={{ flex: 1, minHeight: '160px', background: 'var(--color-background)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <canvas ref={aoCanvasRef} style={{ maxWidth: '100%', maxHeight: '160px', display: 'block', objectFit: 'contain' }} />
                      </div>
                    </div>
                  </div>

                  {/* Export Trigger Block */}
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export PBR Textures</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Saves maps next to original file as lossless PNGs.
                        </span>
                      </div>
                      <button
                        onClick={handleExport}
                        disabled={isSaving}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'white',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: isSaving ? 0.7 : 1,
                          boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                        }}
                      >
                        {isSaving ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Export Textures</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Workflow Card Move Prompt */}
                    {preloadCardId && exportedFiles.length > 0 && (
                      <div style={{
                        background: 'var(--color-secondary-muted)',
                        border: '1px solid var(--color-secondary)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-3) var(--space-4)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                        marginTop: 'var(--space-2)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <CheckCircle size={14} style={{ color: 'var(--color-secondary)' }} />
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                            Maps Saved next to original texture!
                          </span>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                          Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                        </p>
                        
                        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px' }}>
                          <button
                            onClick={async () => {
                              await moveCardToDone(preloadCardId)
                              useAppStore.getState().setGamedevPreloadTexture(null, null)
                            }}
                            style={{
                              background: 'var(--color-secondary)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--color-text-inverted)',
                              fontSize: '10px',
                              fontWeight: 'var(--weight-semibold)',
                              padding: '5px 10px',
                              cursor: 'pointer'
                            }}
                          >
                            Yes, Mark Ticket as Done
                          </button>
                          <button
                            onClick={() => {
                              useAppStore.getState().setGamedevPreloadTexture(null, null)
                            }}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--color-surface-offset)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--color-text-muted)',
                              fontSize: '10px',
                              padding: '5px 10px',
                              cursor: 'pointer'
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: SEAMLESS TEXTURE GENERATOR */}
        {activeTab === 'seamless' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Repeat size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Seamless Texture Generator:</strong> Convert any non-tiling texture into an infinitely repeating seamless material. Adjust the blend width and stitch edges seamlessly using edge mirror or linear/bilinear feathering overlaps.
              </div>
            </div>

            {!seamlessUrl ? (
              /* Drop Zone */
              <div
                onDragOver={handleSeamlessDragOver}
                onDrop={handleSeamlessDrop}
                onClick={handleSeamlessBrowseClick}
                style={{
                  flex: 1,
                  minHeight: '300px',
                  border: '2px dashed var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-4)',
                  cursor: 'pointer',
                  background: 'var(--color-surface-1)',
                  transition: 'border-color var(--duration-fast), background var(--duration-fast)',
                }}
                onMouseOver={e => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)'
                  e.currentTarget.style.background = 'var(--color-surface-2)'
                }}
                onMouseOut={e => {
                  e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                  e.currentTarget.style.background = 'var(--color-surface-1)'
                }}
              >
                {isSeamlessProcessing ? (
                  <>
                    <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Processing texture...</span>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-surface-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--color-surface-offset)'
                    }}>
                      <Download size={24} style={{ color: 'var(--color-text-muted)', transform: 'rotate(180deg)' }} />
                    </div>
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                        Drag & Drop Base Texture
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        or click to browse local files (.png, .jpg, .jpeg, .tga, .bmp)
                      </span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Seamless Workspace */
              <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
                
                {/* Left Column: Tweak Sliders */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  overflowY: 'auto'
                }}>
                  {/* Settings Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                    <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                    <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                      Stitching Configuration
                    </span>
                  </div>

                  {/* Sliders Container */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    
                    {/* Algorithm Toggle */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                        Blending Algorithm
                      </span>
                      <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                        <button
                          onClick={() => setSeamlessAlgorithm('mirror')}
                          style={{
                            flex: 1,
                            background: seamlessAlgorithm === 'mirror' ? 'var(--color-surface-2)' : 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: seamlessAlgorithm === 'mirror' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                            padding: '6px',
                            fontSize: '11px',
                            fontWeight: 'var(--weight-semibold)',
                            cursor: 'pointer'
                          }}
                        >
                          Mirror Edges
                        </button>
                        <button
                          onClick={() => setSeamlessAlgorithm('feather')}
                          style={{
                            flex: 1,
                            background: seamlessAlgorithm === 'feather' ? 'var(--color-surface-2)' : 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            color: seamlessAlgorithm === 'feather' ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                            padding: '6px',
                            fontSize: '11px',
                            fontWeight: 'var(--weight-semibold)',
                            cursor: 'pointer'
                          }}
                        >
                          Feather / Overlap
                        </button>
                      </div>
                    </div>

                    {/* Blend Width (only if feathering is selected) */}
                    {seamlessAlgorithm === 'feather' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Blend/Overlap Width</span>
                          <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessBlendWidth * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.40"
                          step="0.01"
                          value={seamlessBlendWidth}
                          onChange={e => { setSeamlessBlendWidth(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                          style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                        />
                      </div>
                    )}

                    {/* Luminance Equalizer */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Luminance Equalizer</span>
                        <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessEqualizer * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.05"
                        value={seamlessEqualizer}
                        onChange={e => { setSeamlessEqualizer(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                        style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                      />
                    </div>

                    {/* Wavy Seams (only if feathering is selected) */}
                    {seamlessAlgorithm === 'feather' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--space-2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Wavy Seams (Mask Warping)</span>
                          <span style={{ color: 'var(--color-secondary)' }}>{Math.round(seamlessWavySeams * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.0"
                          max="1.0"
                          step="0.05"
                          value={seamlessWavySeams}
                          onChange={e => { setSeamlessWavySeams(parseFloat(e.target.value)); updateSeamlessPreviewDebounced() }}
                          style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                        />
                      </div>
                    )}

                    {/* Tiling Grid Scale */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--space-2)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                        Preview Repetition Scale
                      </span>
                      <div style={{ display: 'flex', gap: '4px', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
                        {([2, 3, 4] as const).map(scale => (
                          <button
                            key={scale}
                            onClick={() => setSeamlessTilingScale(scale)}
                            style={{
                              flex: 1,
                              background: seamlessTilingScale === scale ? 'var(--color-surface-2)' : 'transparent',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              color: seamlessTilingScale === scale ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                              padding: '6px',
                              fontSize: '11px',
                              fontWeight: 'var(--weight-semibold)',
                              cursor: 'pointer'
                            }}
                          >
                            {scale}x{scale}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Show Grid Helper Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                        Show Tiling Grid Lines
                      </span>
                      <input
                        type="checkbox"
                        checked={seamlessShowGrid}
                        onChange={e => setSeamlessShowGrid(e.target.checked)}
                        style={{
                          width: '14px',
                          height: '14px',
                          accentColor: 'var(--color-primary)',
                          cursor: 'pointer'
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column: 3x3 Canvas Grid & Export */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                  
                  {/* Metadata Header */}
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3) var(--space-4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Active Asset:</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={seamlessPath || ''}>
                        {seamlessPath ? seamlessPath.split(/[\\/]/).pop() : 'Direct Memory'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button
                        onClick={handleSeamlessBrowseClick}
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-base)',
                          fontSize: '11px',
                          padding: '6px 12px',
                          cursor: 'pointer'
                        }}
                      >
                        Change Texture
                      </button>
                      <button
                        onClick={() => {
                          setSeamlessUrl(null)
                          setSeamlessPath(null)
                          setSeamlessExportedFile(null)
                          useAppStore.getState().setGamedevPreloadSeamless(null, null)
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-error-muted)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-error)',
                          fontSize: '11px',
                          padding: '6px 12px',
                          cursor: 'pointer'
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* 3x3 repeating preview grid with before/after compare toggle */}
                  <div style={{
                    flex: 1,
                    background: 'var(--color-background)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-surface-offset)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 'var(--space-4)',
                    overflow: 'hidden',
                    gap: 'var(--space-2)'
                  }}>
                    {/* Before / After Compare Toggle */}
                    <div style={{ display: 'flex', gap: '4px', alignSelf: 'center', background: 'var(--color-surface-1)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
                      <button
                        onClick={() => setSeamlessShowOriginal(false)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '10px',
                          fontWeight: 'var(--weight-semibold)',
                          borderRadius: 'calc(var(--radius-sm) - 1px)',
                          border: 'none',
                          cursor: 'pointer',
                          background: !seamlessShowOriginal ? 'var(--color-primary)' : 'transparent',
                          color: !seamlessShowOriginal ? '#fff' : 'var(--color-text-muted)'
                        }}
                      >
                        Result
                      </button>
                      <button
                        onClick={() => setSeamlessShowOriginal(true)}
                        style={{
                          padding: '4px 12px',
                          fontSize: '10px',
                          fontWeight: 'var(--weight-semibold)',
                          borderRadius: 'calc(var(--radius-sm) - 1px)',
                          border: 'none',
                          cursor: 'pointer',
                          background: seamlessShowOriginal ? 'var(--color-surface-2)' : 'transparent',
                          color: seamlessShowOriginal ? 'var(--color-text-base)' : 'var(--color-text-muted)'
                        }}
                      >
                        Original
                      </button>
                    </div>
                    <canvas ref={seamlessTilingCanvasRef} style={{ width: '100%', height: '100%', maxWidth: '500px', maxHeight: '500px', objectFit: 'contain', background: '#0b0c10', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
                  </div>

                  {/* Export Trigger Block */}
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Seamless Texture</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Saves file next to original image with a _seamless suffix.
                        </span>
                      </div>
                      <button
                        onClick={handleSeamlessExport}
                        disabled={isSeamlessSaving}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'white',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: isSeamlessSaving ? 0.7 : 1,
                          boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                        }}
                      >
                        {isSeamlessSaving ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            <span>Exporting...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Export Texture</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Kanban Card Ticket Done Prompt */}
                    {preloadSeamlessCardId && seamlessExportedFile && (
                      <div style={{
                        background: 'var(--color-secondary-muted)',
                        border: '1px solid var(--color-secondary)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-3) var(--space-4)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                        marginTop: 'var(--space-2)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <CheckCircle size={14} style={{ color: 'var(--color-secondary)' }} />
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                            Seamless texture saved next to original!
                          </span>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', margin: 0 }}>
                          Since you came from a Kanban ticket, would you like to automatically mark it as Done?
                        </p>
                        
                        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '2px' }}>
                          <button
                            onClick={async () => {
                              await moveCardToDone(preloadSeamlessCardId)
                              useAppStore.getState().setGamedevPreloadSeamless(null, null)
                            }}
                            style={{
                              background: 'var(--color-secondary)',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--color-text-inverted)',
                              fontSize: '10px',
                              fontWeight: 'var(--weight-semibold)',
                              padding: '5px 10px',
                              cursor: 'pointer'
                            }}
                          >
                            Yes, Mark Ticket as Done
                          </button>
                          <button
                            onClick={() => {
                              useAppStore.getState().setGamedevPreloadSeamless(null, null)
                            }}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--color-surface-offset)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--color-text-muted)',
                              fontSize: '10px',
                              padding: '5px 10px',
                              cursor: 'pointer'
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 7: ATLAS FORGE (SPRITE PACKER) */}
        {activeTab === 'atlas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Grid size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Atlas Forge:</strong> Mathematically pack loose sprite sheets and UI assets into highly-optimized texture atlases. Select a directory containing loose PNG assets, tweak spacing, and automatically trim alpha borders.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
              {/* Left Column: Packing Configuration */}
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                overflowY: 'auto'
              }}>
                {/* Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                  <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    Packer Settings
                  </span>
                </div>

                {/* Directory Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Source Directory
                  </span>
                  <button
                    onClick={handleSelectAtlasFolder}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '10px var(--space-3)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      overflow: 'hidden'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 'var(--space-2)' }}>
                      {atlasFolderPath ? atlasFolderPath.split(/[\\/]/).pop() : 'Choose a Folder...'}
                    </span>
                    <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                  </button>
                  {atlasFolderPath && (
                    <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', overflowWrap: 'break-word' }}>
                      Path: {atlasFolderPath}
                    </span>
                  )}
                </div>

                {/* Sliders and Toggles Container */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {/* Padding Slider */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                      <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Border Padding</span>
                      <span style={{ color: 'var(--color-secondary)' }}>{atlasPadding}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="32"
                      step="1"
                      value={atlasPadding}
                      onChange={e => setAtlasPadding(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                    />
                  </div>

                  {/* Max Atlas Size Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                      Max Atlas Size
                    </span>
                    <select
                      value={atlasMaxSize}
                      onChange={e => setAtlasMaxSize(parseInt(e.target.value) as any)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-text-base)',
                        fontSize: 'var(--text-xs)',
                        padding: '8px var(--space-2)',
                        cursor: 'pointer',
                        width: '100%',
                        outline: 'none'
                      }}
                    >
                      <option value={1024}>1024 x 1024</option>
                      <option value={2048}>2048 x 2048</option>
                      <option value={4096}>4096 x 4096</option>
                    </select>
                  </div>

                  {/* Auto-Trim Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Auto-Trim Transparency</span>
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Cuts out bounding alpha borders</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={atlasAutoTrim}
                      onChange={e => setAtlasAutoTrim(e.target.checked)}
                      style={{
                        width: '14px',
                        height: '14px',
                        accentColor: 'var(--color-primary)',
                        cursor: 'pointer'
                      }}
                    />
                  </div>
                </div>

                {/* Reality Check Warnings */}
                {atlasSprites.length > 150 && (
                  <div style={{
                    background: 'rgba(255, 170, 0, 0.1)',
                    border: '1px solid rgba(255, 170, 0, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: '10px',
                    color: '#ffbb00',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    lineHeight: '1.4'
                  }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>
                      High Sprite Count Warning: Packing {atlasSprites.length} textures. Chrome is capped at 200 loose frames to prevent memory exhaustion.
                    </span>
                  </div>
                )}
              </div>

              {/* Right Column: 2D Packing Preview Canvas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                {/* Meta Header */}
                <div style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Atlas Status:</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                      {atlasFolderPath ? `${atlasSprites.length} Sprites Loaded` : 'Idle - Please choose folder'}
                    </span>
                  </div>
                  {atlasLayout && (
                    <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '11px' }}>
                      <div>
                        <span style={{ color: 'var(--color-text-muted)', marginRight: '4px' }}>Packed Dimensions:</span>
                        <span style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)' }}>{atlasLayout.size} x {atlasLayout.size} px</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Canvas Render Area */}
                <div style={{
                  flex: 1,
                  background: 'var(--color-background)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-surface-offset)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-4)',
                  overflow: 'hidden'
                }}>
                  {!atlasFolderPath ? (
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Box size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Folder Selected</span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Select a folder of loose sprites to begin forging the atlas.</span>
                      </div>
                      <button
                        onClick={handleSelectAtlasFolder}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'white',
                          fontWeight: 'var(--weight-semibold)',
                          fontSize: 'var(--text-xs)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                        }}
                      >
                        Choose Folder
                      </button>
                    </div>
                  ) : isAtlasPacking ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Calculating optimum packing layout...</span>
                    </div>
                  ) : (
                    <canvas ref={atlasPreviewCanvasRef} style={{ width: '100%', height: '100%', maxWidth: '500px', maxHeight: '500px', objectFit: 'contain', background: '#0b0c10', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
                  )}
                </div>

                {/* Export Trigger Block */}
                {atlasFolderPath && atlasLayout && (
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Atlas & Metadata</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Saves atlas.png and atlas.json directly inside the sprite folder.
                        </span>
                      </div>
                      <button
                        onClick={handleAtlasExport}
                        disabled={isAtlasSaving}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-secondary) 0%, #00aa55 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-inverted)',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: isAtlasSaving ? 0.7 : 1,
                          boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                        }}
                      >
                        {isAtlasSaving ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Export Sprite Atlas</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Saved file notification info */}
                    {atlasExportedPng && (
                      <div style={{
                        background: 'rgba(0, 255, 128, 0.05)',
                        border: '1px solid rgba(0, 255, 128, 0.2)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                        fontSize: '11px',
                        color: 'var(--color-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircle size={13} />
                          <strong>Atlas generated successfully!</strong>
                        </div>
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>PNG Path: {atlasExportedPng}</span>
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>JSON Path: {atlasExportedJson}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 8: SPRITE SLICER */}
        {activeTab === 'slicer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Scissors size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Sprite Slicer:</strong> Dissect large composite texture sheets into separate frames. Choose between a uniform pixel grid or auto-slicing (pixel island clustering).
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
              {/* Left Configuration Column */}
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                overflowY: 'auto'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                  <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    Slicing Settings
                  </span>
                </div>

                {/* File input button */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Sprite Sheet Image
                  </span>
                  <button
                    onClick={handleSelectSlicerFile}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '10px var(--space-3)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      overflow: 'hidden'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 'var(--space-2)' }}>
                      {slicerPath ? slicerPath.split(/[\\/]/).pop() : 'Load Texture...'}
                    </span>
                    <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                  </button>
                </div>

                {/* Slicing mode selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Slicing Mode
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', background: 'var(--color-background)', padding: '2px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-surface-offset)' }}>
                    <button
                      onClick={() => setSliceMode('grid')}
                      style={{
                        background: sliceMode === 'grid' ? 'var(--color-surface-offset)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: sliceMode === 'grid' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                        fontSize: '11px',
                        padding: '6px',
                        cursor: 'pointer',
                        fontWeight: sliceMode === 'grid' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                      }}
                    >
                      Uniform Grid
                    </button>
                    <button
                      onClick={() => setSliceMode('auto')}
                      style={{
                        background: sliceMode === 'auto' ? 'var(--color-surface-offset)' : 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: sliceMode === 'auto' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                        fontSize: '11px',
                        padding: '6px',
                        cursor: 'pointer',
                        fontWeight: sliceMode === 'auto' ? 'var(--weight-bold)' : 'var(--weight-normal)'
                      }}
                    >
                      Pixel Islands
                    </button>
                  </div>
                </div>

                {/* Grid Slicing inputs */}
                {sliceMode === 'grid' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Cell Width (px)</span>
                      <input
                        type="number"
                        value={sliceCellW}
                        onChange={e => setSliceCellW(Math.max(4, parseInt(e.target.value) || 32))}
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-base)',
                          fontSize: 'var(--text-xs)',
                          padding: '8px',
                          outline: 'none'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Cell Height (px)</span>
                      <input
                        type="number"
                        value={sliceCellH}
                        onChange={e => setSliceCellH(Math.max(4, parseInt(e.target.value) || 32))}
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-base)',
                          fontSize: 'var(--text-xs)',
                          padding: '8px',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Canvas Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                {/* Meta header */}
                <div style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Slicer Status:</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                      {slicerPath ? `${slicedFrames.length} Slices Identified` : 'Idle - Please load image'}
                    </span>
                    {slicerPath && sliceMode === 'grid' && slicerDims && (slicerDims.w % sliceCellW > 0 || slicerDims.h % sliceCellH > 0) && (
                      <span style={{ fontSize: '10px', color: '#ffbb00', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={11} />
                        {slicerDims.w % sliceCellW}px width, {slicerDims.h % sliceCellH}px height remainder discarded.
                      </span>
                    )}
                  </div>
                </div>

                {/* Preview Canvas Area */}
                <div style={{
                  flex: 1,
                  background: 'var(--color-background)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-surface-offset)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-4)',
                  overflow: 'hidden'
                }}>
                  {!slicerUrl ? (
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Scissors size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Choose a composite texture or grid sheet to partition.</span>
                      </div>
                      <button
                        onClick={handleSelectSlicerFile}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'white',
                          fontWeight: 'var(--weight-semibold)',
                          fontSize: 'var(--text-xs)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                        }}
                      >
                        Choose Image
                      </button>
                    </div>
                  ) : isSlicerProcessing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Loader size={32} className="animate-spin" style={{ color: 'var(--color-secondary)' }} />
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Slicing texture regions...</span>
                    </div>
                  ) : (
                    <canvas ref={slicerPreviewCanvasRef} style={{ width: '100%', height: '100%', maxWidth: '500px', maxHeight: '500px', objectFit: 'contain', background: '#0b0c10', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
                  )}
                </div>

                {/* Sliced Export Trigger */}
                {slicerPath && slicedFrames.length > 0 && (
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Slices</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Saves individual sliced PNG files directly to the directory of the original sheet.
                        </span>
                      </div>
                      <button
                        onClick={handleSlicerExport}
                        disabled={isSlicerSaving}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-secondary) 0%, #00aa55 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-inverted)',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: isSlicerSaving ? 0.7 : 1,
                          boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                        }}
                      >
                        {isSlicerSaving ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            <span>Exporting...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Save Slices</span>
                          </>
                        )}
                      </button>
                    </div>

                    {slicerExportedCount !== null && (
                      <div style={{
                        background: 'rgba(0, 255, 128, 0.05)',
                        border: '1px solid rgba(0, 255, 128, 0.2)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                        fontSize: '11px',
                        color: 'var(--color-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <CheckCircle size={13} />
                        <strong>Successfully sliced and saved {slicerExportedCount} sprites!</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 9: LUT COLOR GRADER */}
        {activeTab === 'lut' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Sliders size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>LUT Color Grader:</strong> Real-time color correction editor. Adjust filters and sliders to grade a standard neutral 3D look-up table strip ($256\times16$ pixels), compatible with Unity, Unreal, and Godot.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
              {/* Left Columns Sliders */}
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                overflowY: 'auto'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                  <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    Color Adjustments
                  </span>
                </div>

                {/* Exposure Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Exposure</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{lutExposure > 0 ? `+${lutExposure}` : lutExposure}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={lutExposure}
                    onChange={e => setLutExposure(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Brightness Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Brightness</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{lutBrightness > 0 ? `+${lutBrightness}` : lutBrightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={lutBrightness}
                    onChange={e => setLutBrightness(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Contrast Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Contrast</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{lutContrast > 0 ? `+${lutContrast}` : lutContrast}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={lutContrast}
                    onChange={e => setLutContrast(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Saturation Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Saturation</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{lutSaturation > 0 ? `+${lutSaturation}` : lutSaturation}%</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={lutSaturation}
                    onChange={e => setLutSaturation(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Temperature Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>Temperature</span>
                    <span style={{ color: 'var(--color-secondary)' }}>{lutTemperature > 0 ? `Warm (+${lutTemperature})` : lutTemperature < 0 ? `Cool (${lutTemperature})` : 'Neutral'}</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={lutTemperature}
                    onChange={e => setLutTemperature(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                  />
                </div>

                {/* Reset button */}
                <button
                  onClick={() => {
                    setLutExposure(0)
                    setLutBrightness(0)
                    setLutContrast(0)
                    setLutSaturation(0)
                    setLutTemperature(0)
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-muted)',
                    fontSize: '11px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    marginTop: 'var(--space-2)'
                  }}
                >
                  Reset Defaults
                </button>
              </div>

              {/* Right Preview Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                {/* Meta header */}
                <div style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Grader Viewport:</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                      Color Spectrum (Left) | Demo Scene (Right) | LUT Strip (Bottom)
                    </span>
                  </div>
                </div>

                {/* Canvas viewport */}
                <div style={{
                  flex: 1,
                  background: 'var(--color-background)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-surface-offset)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-4)',
                  overflow: 'hidden'
                }}>
                  <canvas ref={lutPreviewCanvasRef} style={{ width: '100%', height: '100%', maxWidth: '512px', maxHeight: '272px', objectFit: 'contain', background: '#0b0c10', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)' }} />
                </div>

                {/* Export LUT Strip */}
                <div style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export LUT Strip</span>
                      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        Saves standard neutral 3D lut slice strip ($256\times16$ px) next to currently loaded project assets.
                      </span>
                    </div>
                    <button
                      onClick={handleLutExport}
                      disabled={isLutSaving}
                      style={{
                        background: 'linear-gradient(135deg, var(--color-secondary) 0%, #00aa55 100%)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-text-inverted)',
                        fontWeight: 'var(--weight-semibold)',
                        padding: '10px 20px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        opacity: isLutSaving ? 0.7 : 1,
                        boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                      }}
                    >
                      {isLutSaving ? (
                        <>
                          <Loader size={14} className="animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Download size={14} />
                          <span>Export LUT strip</span>
                        </>
                      )}
                    </button>
                  </div>

                  {lutExportedPath && (
                    <div style={{
                      background: 'rgba(0, 255, 128, 0.05)',
                      border: '1px solid rgba(0, 255, 128, 0.2)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: '11px',
                      color: 'var(--color-secondary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle size={13} />
                        <strong>LUT generated successfully!</strong>
                      </div>
                      <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Saved Path: {lutExportedPath}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 10: PIXEL ART UPSCALER */}
        {activeTab === 'upscaler' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
            <div className="gamedev-info-banner">
              <Maximize2 size={15} className="gamedev-info-banner-icon" />
              <div>
                <strong>Pixel Art Upscaler:</strong> Upscale retro low-resolution textures using crisp integer multipliers or classic Scale2x/Scale3x interpolation rules.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 'var(--space-4)', minHeight: 0, flex: 1 }}>
              {/* Left Configuration Column */}
              <div style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                overflowY: 'auto'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-2)' }}>
                  <Settings size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    Upscale Settings
                  </span>
                </div>

                {/* File picker */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Source Image
                  </span>
                  <button
                    onClick={handleSelectUpscaleFile}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '10px var(--space-3)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      overflow: 'hidden'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 'var(--space-2)' }}>
                      {upscalePath ? upscalePath.split(/[\\/]/).pop() : 'Load Texture...'}
                    </span>
                    <Plus size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                  </button>
                </div>

                {/* Algorithm selection dropdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                    Scaling Filter
                  </span>
                  <select
                    value={upscaleAlgorithm}
                    onChange={e => setUpscaleAlgorithm(e.target.value as any)}
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-base)',
                      fontSize: 'var(--text-xs)',
                      padding: '8px var(--space-2)',
                      cursor: 'pointer',
                      width: '100%',
                      outline: 'none'
                    }}
                  >
                    <optgroup label="Edge-smart (EPX / AdvMAME)">
                      <option value="scale2x">Scale2x, smoothed edges, 2×</option>
                      <option value="scale3x">Scale3x, smoothed edges, 3×</option>
                      <option value="scale4x">Scale4x, smoothed edges, 4×</option>
                    </optgroup>
                    <optgroup label="Crisp (Nearest Neighbor)">
                      <option value="nearest2x">Nearest 2×, exact pixels</option>
                      <option value="nearest4x">Nearest 4×, exact pixels</option>
                      <option value="nearest8x">Nearest 8×, exact pixels</option>
                    </optgroup>
                  </select>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
                    Scale2x/3x/4x round jagged staircase edges without blurring. Nearest keeps every pixel perfectly square.
                  </span>
                </div>

                {/* Before / after compare */}
                {upscaleUrl && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={upscaleShowOriginal}
                      onChange={e => setUpscaleShowOriginal(e.target.checked)}
                    />
                    <span>Compare: show original (nearest-scaled)</span>
                  </label>
                )}
              </div>

              {/* Right Viewport Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
                {/* Meta header */}
                <div style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {upscaleShowOriginal ? 'Viewing: Original (nearest-scaled for comparison)' : 'Viewing: Upscaled result'}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', fontFamily: 'var(--font-mono)' }}>
                      {upscaleDims
                        ? `${upscaleDims.w}×${upscaleDims.h} → ${upscaleDims.ow}×${upscaleDims.oh} (${Math.round(upscaleDims.ow / upscaleDims.w)}×)`
                        : 'Idle, load or drop an image'}
                    </span>
                  </div>
                </div>

                {/* Viewport canvas, accepts drag & drop */}
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleUpscaleDrop}
                  style={{
                    flex: 1,
                    background: 'var(--color-background)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-surface-offset)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 'var(--space-4)',
                    overflow: 'hidden'
                  }}
                >
                  {!upscaleUrl ? (
                    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <Maximize2 size={40} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>No Image Loaded</span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Drop a pixel-art image here, or browse for one.</span>
                      </div>
                      <button
                        onClick={handleSelectUpscaleFile}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-primary) 0%, #0055ff 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'white',
                          fontWeight: 'var(--weight-semibold)',
                          fontSize: 'var(--text-xs)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(30, 69, 252, 0.3)'
                        }}
                      >
                        Choose Image
                      </button>
                    </div>
                  ) : (
                    // imageRendering: pixelated, without it the browser's smooth
                    // downscale blurs the crisp result, defeating the whole tool
                    <canvas
                      ref={upscalePreviewCanvasRef}
                      style={{
                        width: '100%',
                        height: '100%',
                        maxWidth: '520px',
                        maxHeight: '520px',
                        objectFit: 'contain',
                        imageRendering: 'pixelated',
                        background: '#0b0c10',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                      }}
                    />
                  )}
                </div>

                {/* Export trigger */}
                {upscalePath && upscaleUrl && (
                  <div style={{
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-4)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-3)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>Export Upscaled</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Saves upscaled texture next to original image with an upscaled suffix.
                        </span>
                      </div>
                      <button
                        onClick={handleUpscaleExport}
                        disabled={isUpscaleSaving}
                        style={{
                          background: 'linear-gradient(135deg, var(--color-secondary) 0%, #00aa55 100%)',
                          border: 'none',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-inverted)',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '10px 20px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          opacity: isUpscaleSaving ? 0.7 : 1,
                          boxShadow: '0 4px 12px rgba(0, 200, 100, 0.3)'
                        }}
                      >
                        {isUpscaleSaving ? (
                          <>
                            <Loader size={14} className="animate-spin" />
                            <span>Exporting...</span>
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            <span>Save Upscaled</span>
                          </>
                        )}
                      </button>
                    </div>

                    {upscaleExportedPath && (
                      <div style={{
                        background: 'rgba(0, 255, 128, 0.05)',
                        border: '1px solid rgba(0, 255, 128, 0.2)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                        fontSize: '11px',
                        color: 'var(--color-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircle size={13} />
                          <strong>Upscaled successfully saved!</strong>
                        </div>
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>Saved Path: {upscaleExportedPath}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: MAP MAKER */}
        {activeTab === 'mapmaker' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MapMakerView />
          </div>
        )}

      </div>
    </div>
  )
}
