import {
  arrowAnchors, arrowGeometry, arrowHeadInset, arrowHeadPoints, gridSpacing,
  ARROW_HEAD_MODES, ARROW_SHAPES, type WallCamera, type WallItem
} from '../../../../shared/wallModel'

/*
 * Painting the wall by hand, between renders. A pan or a drag moves things many
 * times a frame, and putting each of those through React re-rendered every item
 * on the wall. These write onto the elements the last render left instead.
 */

/** Moves the view by hand, without going through React. */
export function paintWallCamera(viewport: HTMLElement, cam: WallCamera): void {
  const transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
  viewport.querySelectorAll<HTMLElement>('[data-wall-camera-layer]').forEach(layer => {
    layer.style.transform = transform
  })
  viewport.style.backgroundPosition = `${cam.x}px ${cam.y}px`
  const dots = gridSpacing(cam.zoom)
  viewport.style.backgroundSize = `${dots}px ${dots}px`

  // The minimap's window onto the wall, kept in step so it does not sit still
  // through the pan and then jump at the end. Its scale and offsets cannot
  // change while a pan runs, so they ride along on the element itself.
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

/**
 * Marks what is selected on the elements themselves, and returns what is now
 * marked, for the next call to diff against.
 *
 * Selection is not passed down to the items. It used to be, and releasing a
 * marquee over fifty of them re-rendered fifty subtrees on that one frame.
 * Here only the elements whose state actually changed are touched, and
 * index.css draws the rest. With nothing painted yet, or with `all`, every
 * item is written.
 */
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

/** Moves items, and the arrows on them, by hand without going through React. */
export function paintWallItems(viewport: HTMLElement, items: WallItem[], ids: Set<string>): void {
  const byId = new Map(items.map(i => [i.id, i]))

  ids.forEach(id => {
    const item = byId.get(id)
    const el = viewport.querySelector<HTMLElement>(`[data-wall-item="${id}"]`)
    if (!item || !el) return
    el.style.transform = `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`
  })

  // An arrow has no position of its own. One on a moving item is redrawn
  // from wherever both its ends now are, the same way the render draws it.
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
    // In the order the render puts them: the end head first, then the start.
    const [endHead, startHead] = Array.from(g.querySelectorAll('polygon'))
    endHead?.setAttribute('points', arrowHeadPoints(geo.end, geo.endAngle, width))
    startHead?.setAttribute('points', arrowHeadPoints(geo.start, geo.startAngle, width))
  })
}
