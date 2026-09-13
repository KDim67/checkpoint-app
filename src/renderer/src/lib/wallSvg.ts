/** the wall as an SVG: the PNG's drawing as shapes and text that stay sharp at any size */

import {
  arrowAnchors, arrowDash, arrowGeometry, arrowHeadInset, arrowHeadPoints, boundsOf, inkNaturalSize, inkPath,
  inPaintOrder, ARROW_HEAD_MODES, ARROW_LINES, ARROW_SHAPES, SHAPE_TYPES, type TextAlign, type WallItem
} from '../../../shared/wallModel'
import { plainWallText } from '../../../shared/wallText'
import { shapeOutline, shapeTextBox, textAlignOf } from '../../../shared/wallShape'
import { HIGHLIGHT_OPACITY } from '../../../shared/wallInk'
import { languageLabel } from '../../../shared/wallCode'
import { getTextColorForBackground } from './contrast'
import { wrapLines } from './wallWrap'

/** the PNG's, so the two exports frame the wall alike */
const MARGIN = 40
const FONT = 'sans-serif'

export interface SvgContext {
  /** live titles, the wall stores references */
  titleOf: (item: WallItem) => string | undefined
  background: string
  textColor: string
  surfaceColor: string
  borderColor: string
  /** width of the text at that font size */
  measure: (text: string, size: number) => number
  /** a data: URI for an image's file; undefined draws a placeholder */
  imageData: (ref: string) => string | undefined
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** two places are plenty and keep the file small */
const n = (value: number): string => String(Math.round(value * 100) / 100)

const ANCHORS: Record<TextAlign, string> = { left: 'start', center: 'middle', right: 'end' }

/** where a line of that side starts from, inside a box from left to left + width */
const anchorX = (side: TextAlign, left: number, width: number): number =>
  side === 'center' ? left + width / 2 : side === 'right' ? left + width : left

/** one tspan a line, placed by baseline */
function lines(
  text: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  size: number,
  fill: string,
  style: { weight?: number; side?: TextAlign } = {}
): string {
  if (text.every(line => !line)) return ''
  const spans = text.map((line, i) => `<tspan x="${n(x)}" y="${n(firstBaseline + i * lineHeight)}">${esc(line)}</tspan>`).join('')
  const anchor = style.side && style.side !== 'left' ? ` text-anchor="${ANCHORS[style.side]}"` : ''
  return `<text font-family="${FONT}" font-size="${size}"${style.weight ? ` font-weight="${style.weight}"` : ''}${anchor} fill="${esc(fill)}">${spans}</text>`
}

function drawItem(item: WallItem, byId: Map<string, WallItem>, ctx: SvgContext): string {
  const wrap = (text: string, width: number, size: number): string[] => wrapLines(text, width, s => ctx.measure(s, size))

  if (item.kind === 'arrow') {
    const ends = arrowAnchors(item, byId)
    if (!ends) return ''
    const width = item.strokeWidth ?? 2
    const heads = item.arrowHeads ?? ARROW_HEAD_MODES[0]
    const inset = arrowHeadInset(width)
    const g = arrowGeometry(ends.from, ends.to, item.arrowShape ?? ARROW_SHAPES[0], {
      end: heads !== 'none' ? inset : 0,
      start: heads === 'both' ? inset : 0
    })
    const stroke = esc(item.color || ctx.textColor)
    const dash = arrowDash(item.arrowLine ?? ARROW_LINES[0], width)
    let out = `<path d="${g.d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
    if (heads !== 'none') out += `<polygon points="${arrowHeadPoints(g.end, g.endAngle, width)}" fill="${stroke}"/>`
    if (heads === 'both') out += `<polygon points="${arrowHeadPoints(g.start, g.startAngle, width)}" fill="${stroke}"/>`
    if (item.text) {
      // on a chip so the line doesn't run through the words
      const boxWidth = ctx.measure(item.text, 12) + 12
      out += `<rect x="${n(g.mid.x - boxWidth / 2)}" y="${n(g.mid.y - 9)}" width="${n(boxWidth)}" height="18" fill="${esc(ctx.surfaceColor)}" stroke="${esc(ctx.borderColor)}"/>`
      out += `<text x="${n(g.mid.x)}" y="${n(g.mid.y + 4)}" font-family="${FONT}" font-size="12" font-weight="500" text-anchor="middle" fill="${esc(ctx.textColor)}">${esc(item.text)}</text>`
    }
    return out
  }

  if (item.kind === 'ink') {
    // the viewBox scaling the wall uses, so a resized stroke thickens the same way
    const natural = inkNaturalSize(item)
    const sx = natural.width === 0 ? 1 : item.width / natural.width
    const sy = natural.height === 0 ? 1 : item.height / natural.height
    return `<path d="${inkPath(item)}" transform="translate(${n(item.x)} ${n(item.y)}) scale(${n(sx)} ${n(sy)})" fill="none" stroke="${esc(item.color || ctx.textColor)}" stroke-width="${item.strokeWidth ?? 4}" stroke-linecap="round" stroke-linejoin="round"${item.highlight ? ` opacity="${HIGHLIGHT_OPACITY}"` : ''}/>`
  }

  if (item.kind === 'image') {
    const data = item.ref ? ctx.imageData(item.ref) : undefined
    if (data) {
      return `<image href="${esc(data)}" xlink:href="${esc(data)}" x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" preserveAspectRatio="none"/>`
    }
    return `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" fill="${esc(ctx.surfaceColor)}" stroke="${esc(ctx.borderColor)}"/>`
  }

  if (item.kind === 'note') {
    const side = textAlignOf(item)
    const rect = `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" fill="${esc(item.color || '#f6c453')}"/>`
    const inner = item.width - 24
    return rect + lines(wrap(plainWallText(item.text ?? ''), inner, 13), anchorX(side, item.x + 12, inner), item.y + 26, 18, 13, '#1a1a1a', { side })
  }

  if (item.kind === 'text') {
    const side = textAlignOf(item)
    return lines(wrap(plainWallText(item.text ?? ''), item.width, 20), anchorX(side, item.x, item.width), item.y + 20, 26, 20, item.color || ctx.textColor, { weight: 600, side })
  }

  if (item.kind === 'shape') {
    const outline = item.shape ?? SHAPE_TYPES[0]
    const stroke = item.borderColor || (item.color ? 'rgba(0, 0, 0, 0.25)' : ctx.borderColor)
    const path = `<path d="${shapeOutline(outline, item.width, item.height, item.radius)}" transform="translate(${n(item.x)} ${n(item.y)})" fill="${esc(item.color || ctx.surfaceColor)}"${item.opacity !== undefined ? ` fill-opacity="${n(item.opacity)}"` : ''} stroke="${esc(stroke)}" stroke-width="2" stroke-linejoin="round"/>`
    // centred in the room the outline leaves, as on the wall
    const room = shapeTextBox(outline)
    const left = item.x + (item.width * room.left) / 100
    const innerWidth = (item.width * (100 - room.left - room.right)) / 100
    const top = item.y + (item.height * room.top) / 100
    const innerHeight = (item.height * (100 - room.top - room.bottom)) / 100
    const words = wrap(plainWallText(item.text ?? ''), innerWidth, 14)
    const firstBaseline = top + innerHeight / 2 - ((words.length - 1) * 20) / 2 + 5
    const fill = item.color ? getTextColorForBackground(item.color) : ctx.textColor
    const side = textAlignOf(item)
    return path + lines(words, anchorX(side, left, innerWidth), firstBaseline, 20, 14, fill, { side })
  }

  if (item.kind === 'code') {
    const box = `x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}"`
    const clip = `wall-code-${esc(item.id)}`
    // as many lines as the box shows; spaces kept, indentation is part of the code
    const shown = (item.text ?? '').split('\n').slice(0, Math.max(0, Math.floor((item.height - 34) / 18)))
    const spans = shown.map((line, i) => `<tspan x="${n(item.x + 10)}" y="${n(item.y + 46 + i * 18)}">${esc(line)}</tspan>`).join('')
    return `<clipPath id="${clip}"><rect ${box}/></clipPath>` +
      `<rect ${box} rx="8" fill="${esc(ctx.surfaceColor)}" stroke="${esc(ctx.borderColor)}"/>` +
      `<g clip-path="url(#${clip})">` +
      lines([languageLabel(item.language).toUpperCase()], item.x + 10, item.y + 16, 0, 10, ctx.borderColor) +
      (spans ? `<text font-family="monospace" font-size="12" fill="${esc(ctx.textColor)}" xml:space="preserve" style="white-space:pre">${spans}</text>` : '') +
      '</g>'
  }

  if (item.kind === 'frame') {
    const stroke = item.color || ctx.borderColor
    return `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" rx="8" fill="none" stroke="${esc(stroke)}" stroke-width="2"/>` +
      lines([item.text || 'Frame'], item.x, item.y - 6, 0, 13, stroke, { weight: 600 })
  }

  // cards, notes and pages: a tile with the name
  return `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.width)}" height="${n(item.height)}" fill="${esc(ctx.surfaceColor)}" stroke="${esc(item.color || ctx.borderColor)}"/>` +
    lines(wrap(ctx.titleOf(item) ?? '(missing)', item.width - 24, 14).slice(0, 3), item.x + 12, item.y + 26, 18, 14, ctx.textColor, { weight: 500 })
}

/** null when there's nothing to draw */
export function wallToSvg(items: WallItem[], ctx: SvgContext): string | null {
  const bounds = boundsOf(items)
  if (!bounds) return null

  const left = bounds.minX - MARGIN
  const top = bounds.minY - MARGIN
  const width = bounds.maxX - bounds.minX + MARGIN * 2
  const height = bounds.maxY - bounds.minY + MARGIN * 2
  const byId = new Map(items.map(i => [i.id, i]))

  const body = inPaintOrder(items).map(item => {
    const drawn = drawItem(item, byId, ctx)
    if (!drawn || !item.rotation) return drawn
    return `<g transform="rotate(${n(item.rotation)} ${n(item.x + item.width / 2)} ${n(item.y + item.height / 2)})">${drawn}</g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(left)} ${n(top)} ${n(width)} ${n(height)}" xmlns:xlink="http://www.w3.org/1999/xlink">` +
    `<rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" fill="${esc(ctx.background)}"/>${body}</svg>`
}
