/**
 * Exports a Wall as a PNG by redrawing it onto a canvas. Rasterising the HTML
 * would mean a DOM-to-image dependency.
 *
 * So it is a rendering, not a screenshot: text wraps by a simpler rule and
 * cards are drawn as title plus status. Fine for a moodboard, not pixel-exact.
 */

import {
  arrowAnchors, arrowGeometry, arrowDash, arrowHeadPoints, arrowHeadInset,
  boundsOf, inkNaturalSize, inPaintOrder,
  ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallItem
} from '../../../shared/wallModel'

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

/** Greedy wrap. Good enough for a note, not the browser's algorithm. */
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

/** Null when there is nothing to draw. */
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

  // Wall coordinates, shifted to the margin. The translation the camera applies.
  ctx.translate(MARGIN - bounds.minX, MARGIN - bounds.minY)

  // Arrows are drawn from their two ends, so the ends have to be findable.
  const byId = new Map(items.map(i => [i.id, i]))

  for (const item of inPaintOrder(items)) {
    ctx.save()
    if (item.rotation) {
      ctx.translate(item.x + item.width / 2, item.y + item.height / 2)
      ctx.rotate((item.rotation * Math.PI) / 180)
      ctx.translate(-(item.x + item.width / 2), -(item.y + item.height / 2))
    }

    if (item.kind === 'arrow') {
      // Through the same geometry the canvas draws with. This used to be a
      // second copy of it, which meant a curve exported as a straight line and
      // an end pinned to a point exported as nothing at all.
      const ends = arrowAnchors(item, byId)
      if (ends) {
        const width = item.strokeWidth ?? 2
        const heads = item.arrowHeads ?? ARROW_HEAD_MODES[0]
        const inset = arrowHeadInset(width)
        const g = arrowGeometry(ends.from, ends.to, item.arrowShape ?? ARROW_SHAPES[0], {
          end: heads !== 'none' ? inset : 0,
          start: heads === 'both' ? inset : 0
        })

        ctx.strokeStyle = item.color || ctxInfo.textColor
        ctx.fillStyle = item.color || ctxInfo.textColor
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        const dash = arrowDash(item.arrowLine ?? ARROW_LINES[0], width)
        ctx.setLineDash(dash ? dash.split(' ').map(Number) : [])
        // Path2D takes SVG path data, so the one string serves both renderers.
        ctx.stroke(new Path2D(g.d))
        ctx.setLineDash([])

        const fillHead = (points: string): void => {
          const coords = points.split(' ').map(p => p.split(',').map(Number))
          ctx.beginPath()
          coords.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
          ctx.closePath()
          ctx.fill()
        }

        if (heads !== 'none') fillHead(arrowHeadPoints(g.end, g.endAngle, width))
        if (heads === 'both') fillHead(arrowHeadPoints(g.start, g.startAngle, width))
      }
    } else if (item.kind === 'ink') {
      // Drawn through the same box scaling the SVG uses, so a resized stroke
      // exports at the size it is shown at.
      const natural = inkNaturalSize(item)
      const points = item.points ?? []
      const scaleX = natural.width === 0 ? 1 : item.width / natural.width
      const scaleY = natural.height === 0 ? 1 : item.height / natural.height

      ctx.strokeStyle = item.color || ctxInfo.textColor
      ctx.lineWidth = item.strokeWidth ?? 4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (let i = 0; i < points.length; i += 2) {
        const x = item.x + points[i] * scaleX
        const y = item.y + points[i + 1] * scaleY
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    } else if (item.kind === 'image' && item.ref) {
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
      // Cards and notes: a tile with whatever the thing is called.
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
