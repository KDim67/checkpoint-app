import { useState, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../ui/Toast'
import { useAppStore } from '../../store/appStore'
import { errorMessage } from '../../../../shared/errors'
import * as gamedevApi from '../../data/gamedev'
import * as appApi from '../../data/app'

/** hand-off path from the store, switching tabs so it lands from any tool */
export function useSeamlessTool(isActive: boolean, onActivate: () => void) {
  const { toast } = useToast()

  const preloadSeamlessPath = useAppStore(state => state.gamedevPreloadSeamlessPath)
  const preloadSeamlessCardId = useAppStore(state => state.gamedevSourceSeamlessCardId)

  const [seamlessPath, setSeamlessPath] = useState<string | null>(null)
  const [seamlessUrl, setSeamlessUrl] = useState<string | null>(null)
  const [seamlessBlendWidth, setSeamlessBlendWidth] = useState(0.15) // 15% overlap
  const [seamlessAlgorithm, setSeamlessAlgorithm] = useState<'mirror' | 'feather'>('feather')
  const [seamlessTilingScale, setSeamlessTilingScale] = useState(3) // 3x3 by default
  const [seamlessEqualizer, setSeamlessEqualizer] = useState(0.5) // high-pass brightness equalizer
  const [seamlessWavySeams, setSeamlessWavySeams] = useState(0.5) // seam warp amount
  const [isSeamlessProcessing, setIsSeamlessProcessing] = useState(false)
  const [isSeamlessSaving, setIsSeamlessSaving] = useState(false)
  const [seamlessShowGrid, setSeamlessShowGrid] = useState(false) // show tile boundaries
  const [seamlessExportedFile, setSeamlessExportedFile] = useState<string | null>(null)
  // 'result' shows output, 'original' tiles the raw source
  const [seamlessShowOriginal, setSeamlessShowOriginal] = useState(false)

  const seamlessOriginalImageRef = useRef<HTMLImageElement | null>(null)
  const seamlessTilingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const seamlessGeneratedCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // debounce slider-driven previews
  const seamlessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  const loadSeamlessPath = useCallback(async (path: string) => {
    setIsSeamlessProcessing(true)
    try {
      const res = await gamedevApi.loadTexture(path)
      if (res) {
        setSeamlessPath(res.path)
        setSeamlessUrl(res.dataUrl)
        setSeamlessExportedFile(null)
      }
    } catch (err) {
      console.error(err)
      toast('Failed to load preloaded seamless texture', { type: 'error' })
    } finally {
      setIsSeamlessProcessing(false)
    }
  }, [toast])

  useEffect(() => {
    if (preloadSeamlessPath) {
      onActivate()
      loadSeamlessPath(preloadSeamlessPath)
    }
  }, [preloadSeamlessPath, loadSeamlessPath, onActivate])

  // explicit params, rounded centre, toroidal equalisation, 4-offset blend: seamless by construction
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
      // 4-quadrant mirror, no pixel work
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
      // optional toroidal high-pass brightness equalisation
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
        // toroidal padding so the blur never fades at the edges
        const padW = Math.max(32, Math.round(targetW / 8))
        const padH = Math.max(32, Math.round(targetH / 8))

        const padCanvas = document.createElement('canvas')
        padCanvas.width = targetW + padW * 2
        padCanvas.height = targetH + padH * 2
        const padCtx = padCanvas.getContext('2d')

        if (padCtx) {
          // centre
          padCtx.drawImage(srcCanvas, padW, padH)
          // edge tiles, toroidal wrap
          padCtx.drawImage(srcCanvas, targetW - padW, 0,           padW,    targetH, 0,            padH,           padW,    targetH) // left
          padCtx.drawImage(srcCanvas, 0,           0,           padW,    targetH, targetW + padW, padH,           padW,    targetH) // right
          padCtx.drawImage(srcCanvas, 0,           targetH - padH, targetW, padH,    padW,          0,              targetW, padH)    // top
          padCtx.drawImage(srcCanvas, 0,           0,           targetW, padH,    padW,          targetH + padH, targetW, padH)    // bottom
          // corners
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

            // every 8th pixel for speed
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

      // four wrap-offset copies with separable weights give every seam zero weight; two-sample blends leave whiskers
      const outImgData = ctx.createImageData(targetW, targetH)
      const dst = outImgData.data

      // integer centre, no sub-pixel drift on odd sizes
      const cx = Math.round(targetW / 2)
      const cy = Math.round(targetH / 2)
      // clamped so the band never reaches the shifted copies' centre seams
      const B_w = Math.min(cx - 2, Math.max(4, Math.round(targetW * blendWidth)))
      const B_h = Math.min(cy - 2, Math.max(4, Math.round(targetH * blendWidth)))

      // handles negatives
      const wrapVal = (v: number, limit: number) =>
        ((Math.round(v) % limit) + limit) % limit

      const sampleAt = (px: number, py: number): number =>
        (wrapVal(py, targetH) * targetW + wrapVal(px, targetW)) * 4

      // cheap deterministic hash to dither transitions
      const hash2d = (x: number, y: number) => {
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123
        return h - Math.floor(h)
      }

      const smooth01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v))

      for (let y = 0; y < targetH; y++) {
        // whole cycles, so the wave matches across tiles
        const angleX = (2 * Math.PI * 3 * y) / targetH
        const waveX = Math.sin(angleX) * 0.08 + Math.cos(angleX * 2) * 0.03

        const dyB = Math.min(y, targetH - 1 - y)

        for (let x = 0; x < targetW; x++) {
          const idx = (y * targetW + x) * 4

          const angleY = (2 * Math.PI * 3 * x) / targetW
          const waveY = Math.sin(angleY) * 0.08 + Math.cos(angleY * 2) * 0.03

          const dxB = Math.min(x, targetW - 1 - x)

          // multiplicative wave keeps 0 at the border
          let ax = smooth01((dxB / B_w) * (1 + waveX * wavySeams))
          let ay = smooth01((dyB / B_h) * (1 + waveY * wavySeams))

          // dither to hide banding
          if (wavySeams > 0) {
            if (ax > 0.02 && ax < 0.98) {
              ax = Math.max(0, Math.min(1, ax + (hash2d(x, y) - 0.5) * 0.12 * wavySeams))
            }
            if (ay > 0.02 && ay < 0.98) {
              ay = Math.max(0, Math.min(1, ay + (hash2d(x + 131.7, y + 57.3) - 0.5) * 0.12 * wavySeams))
            }
          }

          const i00 = sampleAt(x, y)

          // the interior is the untouched original, skip the other samples
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
  }, []) // no deps, every input is a parameter

  // true-aspect tiles; downscale once to an integer stamp, per-tile scaling drew hairlines
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
      // compare mode tiles the raw source
      drawTilingCanvas(img, seamlessTilingScale, seamlessShowGrid, aspect)
      return
    }

    let singleTileCanvas = seamlessGeneratedCanvasRef.current
    if (!singleTileCanvas) {
      singleTileCanvas = document.createElement('canvas')
      seamlessGeneratedCanvasRef.current = singleTileCanvas
    }

    // aspect-correct 512 proxy so the math matches the full-res export
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

  // debounced so slider drags don't block
  const updateSeamlessPreviewDebounced = useCallback(() => {
    if (seamlessDebounceRef.current) clearTimeout(seamlessDebounceRef.current)
    seamlessDebounceRef.current = setTimeout(() => updateSeamlessPreview(), 80)
  }, [updateSeamlessPreview])

  useEffect(() => {
    if (!seamlessUrl) return
    const img = new Image()
    img.onload = () => {
      seamlessOriginalImageRef.current = img
      // processing is synchronous, warn on huge textures
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
    if (isActive) {
      updateSeamlessPreview()
    }
  }, [isActive, seamlessBlendWidth, seamlessAlgorithm, seamlessTilingScale, seamlessShowGrid, seamlessShowOriginal, updateSeamlessPreview])

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
      const res = await gamedevApi.saveSeamless({
        originalPath: seamlessPath,
        dataUrl: base64Data
      })

      if (res.success) {
        toast('Seamless texture exported next to original asset!', { type: 'success' })
        setSeamlessExportedFile(res.filePath || 'saved')
      } else {
        throw new Error(res.error || 'Failed to save seamless texture')
      }
    } catch (err) {
      console.error(err)
      toast('Export Error: ' + (errorMessage(err)), { type: 'error' })
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
    setSeamlessShowOriginal(false) // compare back to 'result' for a new file
    try {
      // electron 32 dropped File.path, resolve via preload
      const path = appApi.getPathForFile(file)
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
      const res = await gamedevApi.selectTexture()
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

  return {
    setSeamlessPath,
    setSeamlessUrl,
    setSeamlessExportedFile,
    updateSeamlessPreviewDebounced,
    preloadSeamlessCardId,
    seamlessPath,
    seamlessUrl,
    seamlessBlendWidth,
    setSeamlessBlendWidth,
    seamlessAlgorithm,
    setSeamlessAlgorithm,
    seamlessTilingScale,
    setSeamlessTilingScale,
    seamlessEqualizer,
    setSeamlessEqualizer,
    seamlessWavySeams,
    setSeamlessWavySeams,
    isSeamlessProcessing,
    isSeamlessSaving,
    seamlessShowGrid,
    setSeamlessShowGrid,
    seamlessExportedFile,
    seamlessShowOriginal,
    setSeamlessShowOriginal,
    seamlessTilingCanvasRef,
    handleSeamlessExport,
    handleSeamlessDragOver,
    handleSeamlessDrop,
    handleSeamlessBrowseClick
  }
}

export type SeamlessTool = ReturnType<typeof useSeamlessTool>
