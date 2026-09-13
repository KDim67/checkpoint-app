// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { paintWallCamera, paintWallItems, paintWallSelection } from '../src/renderer/src/components/wall/wallPaint'
import { createWallItem, gridSpacing } from '../src/shared/wallModel'
import { defined } from './helpers/defined'

const viewportWith = (html: string): HTMLElement => {
  const viewport = document.createElement('div')
  viewport.innerHTML = html
  return viewport
}
const selectedIn = (viewport: HTMLElement): string[] =>
  [...viewport.querySelectorAll('[data-wall-selected]')].map(el => el.getAttribute('data-wall-item') ?? '')

describe('paintWallCamera', () => {
  it('moves the dot grid with the camera', () => {
    const viewport = viewportWith('')
    paintWallCamera(viewport, { x: 40, y: -20, zoom: 2 })

    const dots = gridSpacing(2)
    expect(viewport.style.backgroundPosition).toBe('40px -20px')
    expect(viewport.style.backgroundSize).toBe(`${dots}px ${dots}px`)
  })

  it('keeps the minimap window in step, from the geometry the minimap left on it', () => {
    const viewport = viewportWith('<div data-wall-minimap-view data-geom="0.1,8,8,800,600"></div>')
    paintWallCamera(viewport, { x: -100, y: -50, zoom: 2 })

    const view = defined(viewport.querySelector<HTMLElement>('[data-wall-minimap-view]'))
    expect([view.style.left, view.style.top, view.style.width, view.style.height]).toEqual(['13px', '10.5px', '40px', '30px'])
  })

  it('leaves a minimap window alone when its geometry does not read', () => {
    const viewport = viewportWith('<div data-wall-minimap-view data-geom="0.1,8"></div>')
    paintWallCamera(viewport, { x: -100, y: -50, zoom: 2 })

    expect(defined(viewport.querySelector<HTMLElement>('[data-wall-minimap-view]')).style.left).toBe('')
  })
})

describe('paintWallSelection', () => {
  const at = { x: 0, y: 0 }
  const items = [createWallItem('note', at, []), createWallItem('note', at, []), createWallItem('note', at, [])]
  const [a, b, c] = items.map(i => i.id)
  const html = items.map(i => `<div data-wall-item="${i.id}"></div>`).join('')

  it('marks the whole selection the first time, and hands back what it marked', () => {
    const viewport = viewportWith(html)
    const next = new Set([a, c])

    const painted = paintWallSelection(viewport, null, items, next)

    expect(selectedIn(viewport)).toEqual([a, c])
    expect([...painted]).toEqual([a, c])
    expect(painted).not.toBe(next)
  })

  it('touches only the items whose state changed since the last paint', () => {
    const viewport = viewportWith(html)
    paintWallSelection(viewport, null, items, new Set([a]))
    // marked elsewhere, unchanged to the diff, so it stays
    defined(viewport.querySelector(`[data-wall-item="${c}"]`)).setAttribute('data-wall-selected', '')

    paintWallSelection(viewport, new Set([a]), items, new Set([b]))

    expect(selectedIn(viewport)).toEqual([b, c])
  })

  it('writes every item when asked to repaint all of them', () => {
    const viewport = viewportWith(html)
    paintWallSelection(viewport, null, items, new Set([a]))
    defined(viewport.querySelector(`[data-wall-item="${c}"]`)).setAttribute('data-wall-selected', '')

    paintWallSelection(viewport, new Set([a]), items, new Set([b]), true)

    expect(selectedIn(viewport)).toEqual([b])
  })
})

describe('paintWallItems', () => {
  it('redraws an arrow attached to a moved item and leaves the others as they were', () => {
    const left = createWallItem('note', { x: 0, y: 0 }, [])
    const right = createWallItem('note', { x: 400, y: 0 }, [left])
    const far = createWallItem('note', { x: 0, y: 400 }, [left, right])
    const moved = createWallItem('arrow', { x: 0, y: 0 }, [left, right, far], { from: left.id, to: right.id })
    const still = createWallItem('arrow', { x: 0, y: 0 }, [left, right, far, moved], { from: right.id, to: far.id })
    const arrowMarkup = (id: string) => `<svg><g data-wall-arrow="${id}"><path></path><polygon></polygon><polygon></polygon></g></svg>`
    const viewport = viewportWith(arrowMarkup(moved.id) + arrowMarkup(still.id))

    paintWallItems(viewport, [left, right, far, moved, still], new Set([left.id]))

    const pathOf = (id: string) => defined(viewport.querySelector(`[data-wall-arrow="${id}"] path`))
    expect(pathOf(moved.id).getAttribute('d')).toBeTruthy()
    expect(viewport.querySelector(`[data-wall-arrow="${moved.id}"] polygon`)?.getAttribute('points')).toBeTruthy()
    expect(pathOf(still.id).getAttribute('d')).toBeNull()
  })

  it('skips an id with no item or no element', () => {
    const note = createWallItem('note', { x: 10, y: 20 }, [])
    const viewport = viewportWith('')

    expect(() => paintWallItems(viewport, [note], new Set([note.id, 'missing']))).not.toThrow()
  })
})
