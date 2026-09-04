import { useState, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../ui/Toast'
import { errorMessage } from '../../../../shared/errors'

/**
 * Sprite Slicer: sheet selection, grid/auto slicing, and export.
 *
 * A hook rather than state inside SlicerPanel. The panel unmounts on tab
 * switch, which would throw away the sliced frames.
 */
export function useSlicerTool() {
  const { toast } = useToast()

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
    } catch (err) {
      console.error(err)
      toast('Export Error: ' + (errorMessage(err)), { type: 'error' })
    } finally {
      setIsSlicerSaving(false)
    }
  }, [slicerPath, slicedFrames, toast])

  // Run whenever the image or slice parameters change. runSlicer is a no-op
  // when slicerUrl is null, so no activeTab guard is needed.
  useEffect(() => {
    runSlicer()
  }, [slicerUrl, sliceMode, sliceCellW, sliceCellH, runSlicer])

  return {
    slicerPath,
    slicerUrl,
    sliceMode,
    setSliceMode,
    sliceCellW,
    setSliceCellW,
    sliceCellH,
    setSliceCellH,
    slicedFrames,
    isSlicerProcessing,
    isSlicerSaving,
    slicerExportedCount,
    slicerPreviewCanvasRef,
    slicerDims,
    handleSelectSlicerFile,
    handleSlicerExport
  }
}

export type SlicerTool = ReturnType<typeof useSlicerTool>
