import {
  arrowAnchors, arrowGeometry, arrowHeadInset, arrowHeadPoints, gridSpacing,
  ARROW_HEAD_MODES, ARROW_SHAPES, type WallCamera, type WallItem
} from '../../../../shared/wallModel'

/* painted onto the last render's elements; through React every move re-rendered the wall */

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
