/**
 * Display-sized copies of media images.
 *
 * Chromium decodes an image at its full resolution regardless of how small it
 * is drawn, and the decoded bitmap is four bytes a pixel. One 9678x6480 photo
 * dropped on the Wall is 59.8 megapixels, so about 239 MB resident for
 * something rendered at 300x200. A few of those is an out-of-memory crash.
 *
 * So the media protocol serves a scaled copy when the caller asks for one, and
 * keeps it in a cache directory. The originals are untouched: exports, the
 * texture tools and sync all still read the file the user actually added.
 */

import { nativeImage } from 'electron'
import { join, extname, basename } from 'path'
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { getPreviewCacheDir, ensureDir } from './paths'

/**
 * The widths worth caching. A fixed ladder rather than the exact pixel size
 * asked for, or one image resized by a dragging user fills the cache.
 */
export const PREVIEW_WIDTHS = [480, 960, 1920]

/** The smallest cached width that still covers `wanted`. */
export function previewWidthFor(wanted: number): number {
  return PREVIEW_WIDTHS.find(w => w >= wanted) ?? PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1]
}

/**
 * JPEG only where the source had no alpha to lose. A photo re-encoded as PNG
 * is several megabytes for no benefit, but flattening transparency to black is
 * a visible bug.
 */
function previewExtension(source: string): '.jpg' | '.png' {
  return /^\.jpe?g$/i.test(extname(source)) ? '.jpg' : '.png'
}

export function previewFilename(source: string, width: number): string {
  const stem = basename(source, extname(source))
  return `${stem}@${width}${previewExtension(source)}`
}

/** True for a cached copy of `source`, whatever width it was made at. */
export function isPreviewOf(source: string, candidate: string): boolean {
  const stem = basename(source, extname(source))
  if (!candidate.startsWith(`${stem}@`)) return false
  const rest = candidate.slice(stem.length + 1)
  const dot = rest.indexOf('.')
  return dot > 0 && /^[0-9]+$/.test(rest.slice(0, dot))
}

/**
 * Drops every cached copy of a media file, returning the bytes freed. Called
 * when the original is deleted: a preview whose source is gone can never be
 * asked for again, and nothing else would ever clean it up.
 */
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

/**
 * Path to a scaled copy of `filename`, generating it if it is missing.
 *
 * Returns null whenever the original should be served instead: it is already
 * small enough, or Chromium cannot decode it (SVG, or a format it does not
 * know). Null is a normal answer here, not a failure.
 */
export function ensurePreview(sourcePath: string, width: number): string | null {
  if (!existsSync(sourcePath)) return null

  const cacheDir = getPreviewCacheDir()
  const target = join(cacheDir, previewFilename(basename(sourcePath), width))

  // Regenerated when the original is newer, so replacing a file in the media
  // folder cannot leave a stale preview on screen forever.
  if (existsSync(target)) {
    try {
      if (statSync(target).mtimeMs >= statSync(sourcePath).mtimeMs) return target
    } catch {
      // Unreadable timestamps, so fall through and rebuild it.
    }
  }

  try {
    const image = nativeImage.createFromPath(sourcePath)
    if (image.isEmpty()) return null

    const size = image.getSize()
    // Nothing to gain from scaling something already smaller, and upscaling
    // would make it worse and larger at the same time.
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
