/** a canvas rendering, not a screenshot: simpler wrap, cards as title + status */

import {
  arrowAnchors, arrowGeometry, arrowDash, arrowHeadPoints, arrowHeadInset,
  boundsOf, inkNaturalSize, inPaintOrder,
  ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, SHAPE_TYPES, type TextAlign, type WallItem
} from '../../../shared/wallModel'
import { plainWallText } from '../../../shared/wallText'
import { shapeOutline, shapeTextBox, textAlignOf } from '../../../shared/wallShape'
import { HIGHLIGHT_OPACITY } from '../../../shared/wallInk'
import { languageLabel } from '../../../shared/wallCode'
import { getTextColorForBackground } from './contrast'
import { wrapLines } from './wallWrap'
import type { PdfText } from './pdfImages'

/** in wall units */
const MARGIN = 40
/** caps what the GPU will allocate */
const MAX_EDGE = 8000

export interface ExportContext {
  /** live titles, the wall stores references */
  titleOf: (item: WallItem) => string | undefined
  /** from the live theme */
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

/** where a line of that side is drawn from, inside a box from left to left + width */
const anchorX = (side: TextAlign, left: number, width: number): number =>
  side === 'center' ? left + width / 2 : side === 'right' ? left + width : left

/** the drawing on a canvas, and each line of words where it lands for a PDF's text layer; null when there's nothing to draw */
export async function renderWallCanvas(
  items: WallItem[],
  ctxInfo: ExportContext,
  texts?: PdfText[]
): Promise<HTMLCanvasElement | null> {
  const bounds = boundsOf(items)
  if (!bounds) return null

  const width = Math.min(MAX_EDGE, bounds.maxX - bounds.minX + MARGIN * 2)
  const height = Math.min(MAX_EDGE, bounds.maxY - bounds.minY + MARGIN * 2)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const measure = (text: string): number => ctx.measureText(text).width

  const offsetX = MARGIN - bounds.minX
  const offsetY = MARGIN - bounds.minY
  // unrotated, a selectable layer only has to be near its words
  const record = (text: string, anchor: number, baseline: number, size: number, side: TextAlign = 'left'): void => {
    if (!texts || !text.trim()) return
    const w = measure(text)
    const left = side === 'center' ? anchor - w / 2 : side === 'right' ? anchor - w : anchor
    texts.push({ text, x: left + offsetX, y: baseline + offsetY, size, width: w })
  }

  ctx.fillStyle = ctxInfo.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // the camera's translation, shifted to the margin
  ctx.translate(offsetX, offsetY)

  // arrows need their ends findable
  const byId = new Map(items.map(i => [i.id, i]))

  for (const item of inPaintOrder(items)) {
    ctx.save()
    if (item.rotation) {
      ctx.translate(item.x + item.width / 2, item.y + item.height / 2)
      ctx.rotate((item.rotation * Math.PI) / 180)
      ctx.translate(-(item.x + item.width / 2), -(item.y + item.height / 2))
    }

    if (item.kind === 'arrow') {
      // same geometry as the canvas; the old copy exported curves straight
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
        // Path2D takes SVG path data, one string for both
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

        // on a chip so the line doesn't cross it
        if (item.text) {
          ctx.font = '500 12px sans-serif'
          ctx.textBaseline = 'middle'
          const textWidth = ctx.measureText(item.text).width
          const padX = 6
          const boxW = textWidth + padX * 2
          const boxH = 18

          ctx.fillStyle = ctxInfo.surfaceColor
          ctx.strokeStyle = ctxInfo.borderColor
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(g.mid.x - boxW / 2, g.mid.y - boxH / 2, boxW, boxH)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = ctxInfo.textColor
          ctx.fillText(item.text, g.mid.x - boxW / 2 + padX, g.mid.y)
          record(item.text, g.mid.x - boxW / 2 + padX, g.mid.y + 4, 12)
          ctx.textBaseline = 'alphabetic'
        }
      }
    } else if (item.kind === 'ink') {
      // same box scaling as the SVG
      const natural = inkNaturalSize(item)
      const points = item.points ?? []
      const scaleX = natural.width === 0 ? 1 : item.width / natural.width
      const scaleY = natural.height === 0 ? 1 : item.height / natural.height

      if (item.highlight) ctx.globalAlpha = HIGHLIGHT_OPACITY
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
      const side = textAlignOf(item)
      const anchor = anchorX(side, item.x + 12, item.width - 24)
      ctx.textAlign = side
      wrapLines(plainWallText(item.text ?? ''), item.width - 24, measure).forEach((line, i) => {
        ctx.fillText(line, anchor, item.y + 26 + i * 18)
        record(line, anchor, item.y + 26 + i * 18, 13, side)
      })
    } else if (item.kind === 'text') {
      ctx.fillStyle = item.color || ctxInfo.textColor
      ctx.font = '600 20px sans-serif'
      const side = textAlignOf(item)
      const anchor = anchorX(side, item.x, item.width)
      ctx.textAlign = side
      // styles don't survive the canvas, the words and their lines do
      wrapLines(plainWallText(item.text ?? ''), item.width, measure).forEach((line, i) => {
        ctx.fillText(line, anchor, item.y + 20 + i * 26)
        record(line, anchor, item.y + 20 + i * 26, 20, side)
      })
    } else if (item.kind === 'shape') {
      const outline = item.shape ?? SHAPE_TYPES[0]
      ctx.translate(item.x, item.y)
      const path = new Path2D(shapeOutline(outline, item.width, item.height, item.radius))
      ctx.fillStyle = item.color || ctxInfo.surfaceColor
      // the fill alone goes see-through, the border and words stay solid
      ctx.globalAlpha = item.opacity ?? 1
      ctx.fill(path)
      ctx.globalAlpha = 1
      ctx.strokeStyle = item.borderColor || (item.color ? 'rgba(0, 0, 0, 0.25)' : ctxInfo.borderColor)
      ctx.lineWidth = 2
      ctx.stroke(path)

      // centred in the room the outline leaves, as on the wall
      const room = shapeTextBox(outline)
      const left = (item.width * room.left) / 100
      const innerWidth = (item.width * (100 - room.left - room.right)) / 100
      const top = (item.height * room.top) / 100
      const innerHeight = (item.height * (100 - room.top - room.bottom)) / 100
      const lineHeight = 20
      const side = textAlignOf(item)
      const anchor = anchorX(side, left, innerWidth)

      ctx.fillStyle = item.color ? getTextColorForBackground(item.color) : ctxInfo.textColor
      ctx.font = '14px sans-serif'
      ctx.textAlign = side
      ctx.textBaseline = 'middle'
      const lines = wrapLines(plainWallText(item.text ?? ''), innerWidth, measure)
      const firstY = top + innerHeight / 2 - ((lines.length - 1) * lineHeight) / 2
      lines.forEach((line, i) => {
        ctx.fillText(line, anchor, firstY + i * lineHeight)
        // a middle baseline sits about a third of the size above the alphabetic one
        record(line, item.x + anchor, item.y + firstY + i * lineHeight + 5, 14, side)
      })
    } else if (item.kind === 'code') {
      ctx.fillStyle = ctxInfo.surfaceColor
      ctx.fillRect(item.x, item.y, item.width, item.height)
      ctx.strokeStyle = ctxInfo.borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(item.x, item.y, item.width, item.height)
      // cut at the box like the wall, long lines don't wrap in an editor either
      ctx.beginPath()
      ctx.rect(item.x, item.y, item.width, item.height)
      ctx.clip()
      ctx.fillStyle = ctxInfo.borderColor
      ctx.font = '10px sans-serif'
      ctx.fillText(languageLabel(item.language).toUpperCase(), item.x + 10, item.y + 16)
      ctx.fillStyle = ctxInfo.textColor
      ctx.font = '12px monospace'
      ;(item.text ?? '').split('\n').forEach((line, i) => {
        const baseline = item.y + 46 + i * 18
        if (baseline > item.y + item.height) return
        ctx.fillText(line, item.x + 10, baseline)
        record(line, item.x + 10, baseline, 12)
      })
    } else if (item.kind === 'frame') {
      ctx.strokeStyle = item.color || ctxInfo.borderColor
      ctx.lineWidth = 2
      ctx.strokeRect(item.x, item.y, item.width, item.height)
      ctx.fillStyle = item.color || ctxInfo.borderColor
      ctx.font = '600 13px sans-serif'
      ctx.fillText(item.text || 'Frame', item.x, item.y - 6)
      record(item.text || 'Frame', item.x, item.y - 6, 13)
    } else {
      // tile with the name
      ctx.fillStyle = ctxInfo.surfaceColor
      ctx.fillRect(item.x, item.y, item.width, item.height)
      ctx.strokeStyle = item.color || ctxInfo.borderColor
      ctx.lineWidth = 1
      ctx.strokeRect(item.x, item.y, item.width, item.height)
      ctx.fillStyle = ctxInfo.textColor
      ctx.font = '500 14px sans-serif'
      wrapLines(ctxInfo.titleOf(item) ?? '(missing)', item.width - 24, measure)
        .slice(0, 3)
        .forEach((line, i) => {
          ctx.fillText(line, item.x + 12, item.y + 26 + i * 18)
          record(line, item.x + 12, item.y + 26 + i * 18, 14)
        })
    }

    ctx.restore()
  }

  return canvas
}

/** null when there's nothing to draw */
export async function exportWallToPng(items: WallItem[], ctxInfo: ExportContext): Promise<Blob | null> {
  const canvas = await renderWallCanvas(items, ctxInfo)
  return canvas ? new Promise(resolve => canvas.toBlob(resolve, 'image/png')) : null
}

/** a PDF page takes JPEG as it is; the painted background leaves nothing see-through to lose */
export async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** the SVG carries its pictures inside, saved elsewhere it can't reach the media folder */
export async function imageDataUris(items: WallItem[]): Promise<Map<string, string>> {
  const refs = [...new Set(items.filter(i => i.kind === 'image' && i.ref).map(i => i.ref as string))]
  const out = new Map<string, string>()
  for (const ref of refs) {
    const img = await loadImage(ref)
    if (!img) continue
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(img, 0, 0)
    try {
      out.set(ref, canvas.toDataURL('image/png'))
    } catch {
      // a canvas the browser won't read back leaves that picture a placeholder
    }
  }
  return out
}

/** canvas metrics, so the SVG breaks lines where the PNG does */
export function textMeasurer(): (text: string, size: number) => number {
  const ctx = document.createElement('canvas').getContext('2d')
  return (text, size) => {
    if (!ctx) return text.length * size * 0.55
    ctx.font = `${size}px sans-serif`
    return ctx.measureText(text).width
  }
}
