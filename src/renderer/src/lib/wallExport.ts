/**
 * Exporting a Wall as a PNG.
 *
 * The wall is HTML, and there is no way to rasterise HTML from a renderer
 * without pulling in a DOM-to-image library. So this redraws the wall onto a
 * canvas instead: the same coordinates, the same colours, the real images.
 *
 * That makes it a *rendering* rather than a screenshot, and the difference is
 * worth being honest about, text wraps by a simpler rule here than the
 * browser's, and card tiles are drawn as their title and status rather than
 * their full styling. For a moodboard shared with someone else, which is what
 * the export is for, that is close enough. For pixel fidelity it is not, and no
 * amount of effort short of a real rasteriser would make it so.
 */

import { boundsOf, inPaintOrder, type WallItem } from '../../../shared/wallModel'

/** Margin around the content, in wall units. */
const MARGIN = 40
/** Cap so a sprawling wall cannot ask for a canvas the GPU refuses. */
const MAX_EDGE = 8000

export interface ExportContext {
  /** Live title for a card or note, since the wall stores only a reference. */
  titleOf: (item: WallItem) => string | undefined
  /** Resolved background and text colours, read from the live theme. */
  background: string
  textColor: string
  surfaceColor: string
  borderColor: string
}

function loadImage(filename: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `checkpoint-media://${filename}`
  })
}

/** Greedy wrap. Good enough for a note; not the browser's algorithm. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

/**
 * Draws the wall and returns a PNG blob, or null when there is nothing to draw.
 */
export async function exportWallToPng(
  items: WallItem[],
  ctxInfo: ExportContext
): Promise<Blob | null> {
  const bounds = boundsOf(items)
  if (!bounds) return null

  const width = Math.min(MAX_EDGE, bounds.maxX - bounds.minX + MARGIN * 2)
  const height = Math.min(MAX_EDGE, bounds.maxY - bounds.minY + MARGIN * 2)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = ctxInfo.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Everything is drawn in wall coordinates, shifted so the content starts at
  // the margin, the same translation the camera would apply.
  ctx.translate(MARGIN - bounds.minX, MARGIN - bounds.minY)

  for (const item of inPaintOrder(items)) {
    ctx.save()
    if (item.rotation) {
      ctx.translate(item.x + item.width / 2, item.y + item.height / 2)
      ctx.rotate((item.rotation * Math.PI) / 180)
      ctx.translate(-(item.x + item.width / 2), -(item.y + item.height / 2))
    }

    if (item.kind === 'image' && item.ref) {
      const img = await loadImage(item.ref)
      if (img) ctx.drawImage(img, item.x, item.y, item.width, item.height)
    } else if (item.kind === 'note') {
      ctx.fillStyle = item.color || '#f6c453'
      ctx.fillRect(item.x, item.y, item.width, item.height)
      ctx.fillStyle = '#1a1a1a'
      ctx.font = '13px sans-serif'
      wrap(ctx, item.text ?? '', item.width - 24).forEach((line, i) => {
        ctx.fillText(line, item.x + 12, item.y + 26 + i * 18)
      })
    } else if (item.kind === 'text') {
      ctx.fillStyle = item.color || ctxInfo.textColor
      ctx.font = '600 20px sans-serif'
      ctx.fillText(item.text ?? '', item.x, item.y + 24)
    } else if (item.kind === 'frame') {
      ctx.strokeStyle = item.color || ctxInfo.borderColor
      ctx.lineWidth = 2
      ctx.strokeRect(item.x, item.y, item.width, item.height)
      ctx.fillStyle = item.color || ctxInfo.borderColor
      ctx.font = '600 13px sans-serif'
      ctx.fillText(item.text || 'Frame', item.x, item.y - 6)
    } else {
      // Cards and notes: a tile with whatever the thing is actually called.
      ctx.fillStyle = ctxInfo.surfaceColor
      ctx.fillRect(item.x, item.y, item.width, item.height)
      ctx.strokeStyle = item.color || ctxInfo.borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(item.x, item.y, item.width, item.height)
      ctx.fillStyle = ctxInfo.textColor
      ctx.font = '500 14px sans-serif'
      wrap(ctx, ctxInfo.titleOf(item) ?? '(missing)', item.width - 24)
        .slice(0, 3)
        .forEach((line, i) => ctx.fillText(line, item.x + 12, item.y + 26 + i * 18))
    }

    ctx.restore()
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
