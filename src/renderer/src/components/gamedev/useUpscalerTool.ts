import { useState, useCallback, useEffect, useRef } from 'react'
import type { UpscaleAlgorithm } from './types'
import { useToast } from '../ui/Toast'
import { scale2xData, scale3xData } from '../../lib/imageProcessing'
import { errorMessage } from '../../../../shared/errors'
import * as gamedevApi from '../../data/gamedev'
import * as appApi from '../../data/app'

/**
 * Pixel Art Upscaler: source selection, nearest/EPX scaling, and export.
 *
 * isActive gates the re-render effect so the canvas work only runs while the
 * tool is on screen. It is a hook rather than panel state because the panel
 * unmounts on tab switch, which would drop the loaded image.
 */
export function useUpscalerTool(isActive: boolean) {
  const { toast } = useToast()

  // Tab 10: Pixel Art Upscaler State
  const [upscalePath, setUpscalePath] = useState<string | null>(null)
  const [upscaleUrl, setUpscaleUrl] = useState<string | null>(null)
  const [upscaleAlgorithm, setUpscaleAlgorithm] = useState<UpscaleAlgorithm>('scale2x')
  const [upscaleExportedPath, setUpscaleExportedPath] = useState<string | null>(null)
  const [isUpscaleSaving, setIsUpscaleSaving] = useState(false)
  const [upscaleDims, setUpscaleDims] = useState<{ w: number; h: number; ow: number; oh: number } | null>(null)
  const [upscaleShowOriginal, setUpscaleShowOriginal] = useState(false)
  const upscalePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Tab 10: Pixel Art Upscaler Callbacks
  const handleSelectUpscaleFile = useCallback(async () => {
    try {
      const res = await gamedevApi.selectTexture()
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
    // Electron ≥32: File.path no longer exists. Resolve via preload webUtils
    const path = appApi.getPathForFile(file)
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
        // EPX family. Operate on the raw RGBA buffer via the shared pure cores
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
      const res = await gamedevApi.saveUpscaled({
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
    } catch (err) {
      console.error(err)
      toast('Export Upscaled Error: ' + (errorMessage(err)), { type: 'error' })
    } finally {
      setIsUpscaleSaving(false)
    }
  }, [upscalePath, upscaleAlgorithm, toast])

  useEffect(() => {
    if (isActive) {
      runUpscale()
    }
  }, [upscaleUrl, upscaleAlgorithm, isActive, runUpscale])

  return {
    upscalePath,
    upscaleUrl,
    upscaleAlgorithm,
    setUpscaleAlgorithm,
    upscaleExportedPath,
    isUpscaleSaving,
    upscaleDims,
    upscaleShowOriginal,
    setUpscaleShowOriginal,
    upscalePreviewCanvasRef,
    handleSelectUpscaleFile,
    handleUpscaleDrop,
    handleUpscaleExport
  }
}

export type UpscalerTool = ReturnType<typeof useUpscalerTool>
