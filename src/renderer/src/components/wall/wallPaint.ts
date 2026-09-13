import {
  arrowAnchors, arrowGeometry, arrowHeadInset, arrowHeadPoints, gridSpacing,
  ARROW_HEAD_MODES, ARROW_SHAPES, type WallCamera, type WallItem
} from '../../../../shared/wallModel'
import type { GapMark, Guide } from '../../../../shared/wallAlign'

/* painted onto the last render's elements; through React every move re-rendered the wall */

/** three a direction, two edges and a centre can match at once */
export const WALL_GUIDE_SLOTS = ['x0', 'x1', 'x2', 'y0', 'y1', 'y2'] as const

/** one screen pixel thick at any zoom; a slot without a guide is hidden */
export function paintWallGuides(viewport: HTMLElement, guides: Guide[], zoom: number): void {
  const thick = 1 / zoom
  for (const slot of WALL_GUIDE_SLOTS) {
    const el = viewport.querySelector<HTMLElement>(`[data-wall-guide="${slot}"]`)
    if (!el) continue
    const axis = slot[0]
    const guide = guides.filter(g => g.axis === axis)[Number(slot[1])]
    if (!guide) {
      el.style.display = 'none'
      continue
    }
    const length = guide.to - guide.from
    el.style.display = 'block'
    el.style.transform = axis === 'x'
      ? `translate(${guide.at - thick / 2}px, ${guide.from}px)`
      : `translate(${guide.from}px, ${guide.at - thick / 2}px)`
    el.style.width = `${axis === 'x' ? thick : length}px`
    el.style.height = `${axis === 'x' ? length : thick}px`
  }
}

/** a row of three equal gaps is the most a drag shows at once, each way */
export const WALL_GAP_SLOTS = ['gap0', 'gap1', 'gap2', 'gap3', 'gap4', 'gap5'] as const

/** a bar across each equal gap with a tick at either end, so it reads as a measurement and not an edge */
export function paintWallGaps(viewport: HTMLElement, gaps: GapMark[], zoom: number): void {
  const thick = 1 / zoom
  const tick = 7 / zoom
  WALL_GAP_SLOTS.forEach((slot, i) => {
    const el = viewport.querySelector<HTMLElement>(`[data-wall-gap="${slot}"]`)
    if (!el) return
    const gap = gaps[i]
    if (!gap) {
      el.style.display = 'none'
      return
    }
    const length = gap.to - gap.from
    el.style.display = 'block'
    if (gap.axis === 'x') {
      el.style.transform = `translate(${gap.from}px, ${gap.at - tick / 2}px)`
      el.style.width = `${length}px`
      el.style.height = `${tick}px`
      el.style.borderWidth = `0 ${thick}px`
      el.style.backgroundSize = `100% ${thick}px`
    } else {
      el.style.transform = `translate(${gap.at - tick / 2}px, ${gap.from}px)`
      el.style.width = `${tick}px`
      el.style.height = `${length}px`
      el.style.borderWidth = `${thick}px 0`
      el.style.backgroundSize = `${thick}px 100%`
    }
  })
}

export function paintWallCamera(viewport: HTMLElement, cam: WallCamera): void {
  const transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
  viewport.querySelectorAll<HTMLElement>('[data-wall-camera-layer]').forEach(layer => {
    layer.style.transform = transform
  })
  viewport.style.backgroundPosition = `${cam.x}px ${cam.y}px`
  const dots = gridSpacing(cam.zoom)
  viewport.style.backgroundSize = `${dots}px ${dots}px`

  // keep the minimap window moving with the pan
  const view = viewport.querySelector<HTMLElement>('[data-wall-minimap-view]')
  const geom = view?.dataset.geom?.split(',').map(Number)
  if (view && geom && geom.length === 5 && geom.every(Number.isFinite)) {
    const [k, ox, oy, vw, vh] = geom
    view.style.left = `${(-cam.x / cam.zoom) * k + ox}px`
    view.style.top = `${(-cam.y / cam.zoom) * k + oy}px`
    view.style.width = `${(vw / cam.zoom) * k}px`
    view.style.height = `${(vh / cam.zoom) * k}px`
  }
}

/** only elements whose state changed are touched, index.css draws the rest */
export function paintWallSelection(
  viewport: HTMLElement,
  painted: Set<string> | null,
  items: WallItem[],
  next: Set<string>,
  all = false
): Set<string> {
  const touched = all || !painted
    ? items.map(i => i.id)
    : [...new Set([...painted, ...next])].filter(id => painted.has(id) !== next.has(id))

  touched.forEach(id => {
    const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${id}"]`)
    if (!el) return
    if (next.has(id)) el.setAttribute('data-wall-selected', '')
    else el.removeAttribute('data-wall-selected')
  })
  return new Set(next)
}

export function paintWallItems(viewport: HTMLElement, items: WallItem[], ids: Set<string>): void {
  const byId = new Map(items.map(i => [i.id, i]))

  ids.forEach(id => {
    const item = byId.get(id)
    const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${id}"]`)
    if (!item || !el) return
    el.style.transform = `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`
  })

  // arrows on moving items redraw from both ends
  items.forEach(arrow => {
    if (arrow.kind !== 'arrow') return
    if (![arrow.from, arrow.to].some(end => end !== undefined && ids.has(end))) return
    const g = viewport.querySelector<SVGGElement>(`[data-wall-arrow="${arrow.id}"]`)
    const ends = arrowAnchors(arrow, byId)
    if (!g || !ends) return

    const width = arrow.strokeWidth ?? 2
    const heads = arrow.arrowHeads ?? ARROW_HEAD_MODES[0]
    const inset = arrowHeadInset(width)
    const geo = arrowGeometry(ends.from, ends.to, arrow.arrowShape ?? ARROW_SHAPES[0], {
      end: heads !== 'none' ? inset : 0,
      start: heads === 'both' ? inset : 0
    })
    g.querySelector('path')?.setAttribute('d', geo.d)
    // end head first, then start, as rendered
    const [endHead, startHead] = Array.from(g.querySelectorAll('polygon'))
    endHead?.setAttribute('points', arrowHeadPoints(geo.end, geo.endAngle, width))
    startHead?.setAttribute('points', arrowHeadPoints(geo.start, geo.startAngle, width))
  })
}
