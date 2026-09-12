import { useState, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../ui/Toast'
import { buildLutData } from '../../lib/imageProcessing'
import { errorMessage } from '../../../../shared/errors'

/**
 * LUT Color Grader.
 *
 * sourcePath is whichever asset a sibling tool has loaded: the graded strip is
 * written next to it, so this tool has no source of its own. Passed in rather
 * than reached for through a shared store, because the coupling is one-way and
 * worth keeping visible at the call site.
 */
export function useLutTool(isActive: boolean, sourcePath: string | null) {
  const { toast } = useToast()

  // Tab 9: LUT Color Grader State
  const [lutBrightness, setLutBrightness] = useState(0)
  const [lutContrast, setLutContrast] = useState(0)
  const [lutSaturation, setLutSaturation] = useState(0)
  const [lutTemperature, setLutTemperature] = useState(0)
  const [lutExposure, setLutExposure] = useState(0)
  const [lutExportedPath, setLutExportedPath] = useState<string | null>(null)
  const [isLutSaving, setIsLutSaving] = useState(false)
  const lutPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)


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
      // Re-use the shared utility. Output is pixel-perfect identical to the preview
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
      const exportCtx = exportCanvas.getContext('2d')
      if (!exportCtx) throw new Error('This system could not draw the LUT strip')
      exportCtx.putImageData(new ImageData(d, 256, 16), 0, 0)

      const base64Data = exportCanvas.toDataURL('image/png')
      // Anchor the export next to whichever asset is loaded in a sibling tool.
      // No silent fallback directory. Exporting somewhere the user never
      // chose is worse than asking them to load an asset first.
      const basePath = sourcePath
      if (!basePath) {
        toast('Load an image in any texture tool first: the LUT is saved next to that asset.', { type: 'warning' })
        return
      }

      const res = await window.electronAPI.gamedev.saveLut({ originalPath: basePath, dataUrl: base64Data })
      if (res.success) {
        toast('Color graded LUT strip successfully saved to asset directory!', { type: 'success' })
        setLutExportedPath(res.filePath || 'lut.png')
      } else {
        throw new Error(res.error || 'Failed to save')
      }
    } catch (err) {
      console.error(err)
      toast('Export LUT Error: ' + (errorMessage(err)), { type: 'error' })
    } finally {
      setIsLutSaving(false)
    }
  }, [sourcePath, lutBrightness, lutContrast, lutSaturation, lutTemperature, lutExposure, toast])

  useEffect(() => {
    if (isActive) {
      runLutUpdate()
    }
  }, [isActive, runLutUpdate])

  return {
    lutBrightness,
    setLutBrightness,
    lutContrast,
    setLutContrast,
    lutSaturation,
    setLutSaturation,
    lutTemperature,
    setLutTemperature,
    lutExposure,
    setLutExposure,
    lutExportedPath,
    isLutSaving,
    lutPreviewCanvasRef,
    handleLutExport
  }
}

export type LutTool = ReturnType<typeof useLutTool>
