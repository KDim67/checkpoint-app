import { useState, useCallback, useEffect, useRef } from 'react'
import { useToast } from '../ui/Toast'
import { BinaryTreePacker } from '../../lib/imageProcessing'
import { errorMessage } from '../../../../shared/errors'

/**
 * Atlas Forge: folder selection, bin packing, and PNG/JSON export.
 *
 * A hook rather than state inside AtlasPanel. The panel unmounts on tab
 * switch, which would discard a packed sheet.
 */
export function useAtlasTool() {
  const { toast } = useToast()

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
    } catch (err) {
      console.error(err)
      toast('Export Error: ' + (errorMessage(err)), { type: 'error' })
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

  return {
    atlasFolderPath,
    atlasSprites,
    atlasPadding,
    setAtlasPadding,
    atlasMaxSize,
    setAtlasMaxSize,
    atlasAutoTrim,
    setAtlasAutoTrim,
    isAtlasPacking,
    isAtlasSaving,
    atlasExportedPng,
    atlasExportedJson,
    atlasLayout,
    atlasPreviewCanvasRef,
    handleSelectAtlasFolder,
    handleAtlasExport
  }
}

export type AtlasTool = ReturnType<typeof useAtlasTool>
