/** chromium decodes at full res (4 bytes/px), a 60MP wall photo is ~240MB; serve scaled copies */

import { nativeImage } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { getPreviewCacheDir, ensureDir } from './paths'

/** fixed ladder, exact sizes would fill the cache while a user drags */
export const PREVIEW_WIDTHS = [480, 960, 1920]

/** wall asks for 2x the box and items start at 280; 1920 waits, it costs as much as both */
export const EAGER_WIDTHS = [480, 960]

/** pay the sync scale while the user waits on the drop, not a day later; failures ignored, built on demand anyway */
export function warmPreviews(sourcePath: string): void {
  for (const width of EAGER_WIDTHS) {
    try {
      ensurePreview(sourcePath, width)
    } catch (err) {
      console.error(`[mediaPreview] Could not pre-scale ${sourcePath} at ${width}:`, err)
    }
  }
}

/** smallest cached width covering wanted */
export function previewWidthFor(wanted: number): number {
  return PREVIEW_WIDTHS.find(w => w >= wanted) ?? PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1]
}

/** JPEG only without alpha: PNG photos are huge, flattened transparency goes black */
function previewExtension(source: string): '.jpg' | '.png' {
  return /^\.jpe?g$/i.test(extname(source)) ? '.jpg' : '.png'
}

export function previewFilename(source: string, width: number): string {
  const stem = basename(source, extname(source))
  return `${stem}@${width}${previewExtension(source)}`
}

/** any width */
export function isPreviewOf(source: string, candidate: string): boolean {
  const stem = basename(source, extname(source))
  if (!candidate.startsWith(`${stem}@`)) return false
  const rest = candidate.slice(stem.length + 1)
  const dot = rest.indexOf('.')
  return dot > 0 && /^[0-9]+$/.test(rest.slice(0, dot))
}

/** orphaned previews are unreachable, nothing else would clean them */
export function removePreviewsFor(source: string): number {
  const dir = getPreviewCacheDir()
  if (!existsSync(dir)) return 0

  let freed = 0
  try {
    for (const entry of readdirSync(dir)) {
      if (!isPreviewOf(source, entry)) continue
      const path = join(dir, entry)
      try {
        freed += statSync(path).size
        unlinkSync(path)
      } catch (err) {
        console.error(`[mediaPreview] Could not delete ${entry}:`, err)
      }
    }
  } catch (err) {
    console.error('[mediaPreview] Could not read the preview cache:', err)
  }
  return freed
}

/** null means serve the original (small enough, or undecodable like SVG), not a failure */
export function ensurePreview(sourcePath: string, width: number): string | null {
  if (!existsSync(sourcePath)) return null

  const cacheDir = getPreviewCacheDir()
  const target = join(cacheDir, previewFilename(basename(sourcePath), width))

  // regenerate when the original is newer, or a replaced file keeps a stale preview
  if (existsSync(target)) {
    try {
      if (statSync(target).mtimeMs >= statSync(sourcePath).mtimeMs) return target
    } catch {
      // unreadable timestamps, rebuild
    }
  }

  try {
    const image = nativeImage.createFromPath(sourcePath)
    if (image.isEmpty()) return null

    const size = image.getSize()
    // upscaling would be worse and bigger
    if (size.width <= width) return null

    const scaled = image.resize({ width, quality: 'good' })
    const bytes = previewExtension(sourcePath) === '.jpg' ? scaled.toJPEG(82) : scaled.toPNG()
    if (bytes.length === 0) return null

    ensureDir(cacheDir)
    writeFileSync(target, bytes)
    return target
  } catch (err) {
    console.error(`[mediaPreview] Could not scale ${sourcePath}:`, err)
    return null
  }
}
