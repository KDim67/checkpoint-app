// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import WallMinimap from '../src/renderer/src/components/wall/WallMinimap'
import type { WallCamera, WallDoc, WallItem } from '../src/shared/wallModel'

afterEach(cleanup)

describe('WallMinimap', () => {
  const items: WallItem[] = [
    { id: '1', kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 1 },
    { id: '2', kind: 'note', x: 300, y: 0, width: 200, height: 200, z: 2 },
    { id: '3', kind: 'note', x: 600, y: 300, width: 200, height: 200, z: 3 },
    { id: '4', kind: 'frame', x: 0, y: 0, width: 800, height: 500, z: 0 }
  ]

  const defaultCamera: WallCamera = { x: 0, y: 0, zoom: 1 }

  let viewportEl: HTMLDivElement
  let docRef: { current: WallDoc }
  let setCamera: ((camera: WallCamera) => void) & { mock: { calls: [WallCamera][] }; mockClear: () => void }

  beforeEach(() => {
    viewportEl = document.createElement('div')
    viewportEl.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
    })
    docRef = {
      current: {
        version: 1,
        items,
        camera: { ...defaultCamera },
        background: 'default'
      }
    }
    setCamera = vi.fn() as unknown as ((camera: WallCamera) => void) & { mock: { calls: [WallCamera][] }; mockClear: () => void }
  })

  it('renders minimap wireframe elements and viewport box', () => {
    const { container } = render(
      <WallMinimap
        items={items}
        selectedIds={new Set(['1'])}
        camera={defaultCamera}
        viewportRef={{ current: viewportEl }}
        docRef={docRef}
        setCamera={setCamera}
      />
    )

    const map = container.querySelector('[data-wall-minimap]')
    expect(map).toBeTruthy()

    const view = container.querySelector('[data-wall-minimap-view]')
    expect(view).toBeTruthy()
  })

  it('centers camera on click on the minimap', () => {
    const { container } = render(
      <WallMinimap
        items={items}
        selectedIds={new Set()}
        camera={defaultCamera}
        viewportRef={{ current: viewportEl }}
        docRef={docRef}
        setCamera={setCamera}
      />
    )

    const map = container.querySelector('[data-wall-minimap]') as HTMLElement
    expect(map).toBeTruthy()
    map.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 250, bottom: 210, width: 150, height: 110, x: 100, y: 100, toJSON: () => {}
    })

    // Click near middle of minimap
    fireEvent.pointerDown(map, { clientX: 175, clientY: 155, button: 0 })

    expect(setCamera).toHaveBeenCalled()
    const calledWith = setCamera.mock.calls[0][0]
    expect(calledWith).toHaveProperty('x')
    expect(calledWith).toHaveProperty('y')
    expect(calledWith).toHaveProperty('zoom')
  })

  it('pans camera while holding and dragging across the minimap', () => {
    const { container } = render(
      <WallMinimap
        items={items}
        selectedIds={new Set()}
        camera={defaultCamera}
        viewportRef={{ current: viewportEl }}
        docRef={docRef}
        setCamera={setCamera}
      />
    )

    const map = container.querySelector('[data-wall-minimap]') as HTMLElement
    expect(map).toBeTruthy()
    map.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 250, bottom: 210, width: 150, height: 110, x: 100, y: 100, toJSON: () => {}
    })

    // Pointer down to grab
    fireEvent.pointerDown(map, { clientX: 120, clientY: 120, button: 0, pointerId: 1 })
    setCamera.mockClear()

    // Move pointer while holding
    fireEvent.pointerMove(map, { clientX: 160, clientY: 150, pointerId: 1 })
    // Pointer up to release
    fireEvent.pointerUp(map, { clientX: 160, clientY: 150, pointerId: 1 })

    expect(setCamera).toHaveBeenCalled()
  })

  it('zooms camera on mouse wheel over the minimap', () => {
    const { container } = render(
      <WallMinimap
        items={items}
        selectedIds={new Set()}
        camera={defaultCamera}
        viewportRef={{ current: viewportEl }}
        docRef={docRef}
        setCamera={setCamera}
      />
    )

    const map = container.querySelector('[data-wall-minimap]') as HTMLElement
    expect(map).toBeTruthy()
    map.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 250, bottom: 210, width: 150, height: 110, x: 100, y: 100, toJSON: () => {}
    })

    // Wheel up to zoom in
    fireEvent.wheel(map, { deltaY: -100, clientX: 175, clientY: 155 })

    expect(setCamera).toHaveBeenCalled()
    const zoomedIn = setCamera.mock.calls[0][0]
    expect(zoomedIn.zoom).toBeGreaterThan(1)
  })

  it('highlights selected items and renders connector lines on the minimap', () => {
    const itemsWithArrow: WallItem[] = [
      ...items,
      { id: 'arr-1', kind: 'arrow', x: 100, y: 0, width: 200, height: 50, from: '1', to: '2', z: 4 }
    ]

    const { container } = render(
      <WallMinimap
        items={itemsWithArrow}
        selectedIds={new Set(['arr-1', '1'])}
        camera={defaultCamera}
        viewportRef={{ current: viewportEl }}
        docRef={docRef}
        setCamera={setCamera}
      />
    )

    const connectors = container.querySelector('[data-wall-minimap-connectors]')
    expect(connectors).toBeTruthy()

    const arrowLine = container.querySelector('[data-minimap-arrow="arr-1"]') as SVGLineElement
    expect(arrowLine).toBeTruthy()
    expect(arrowLine.getAttribute('stroke')).toBe('var(--color-secondary, #38bdf8)')
    expect(arrowLine.getAttribute('stroke-width')).toBe('2')

    const selectedItem = container.querySelector('[data-minimap-item="1"]') as HTMLDivElement
    expect(selectedItem).toBeTruthy()
    expect(selectedItem.style.outline).toContain('var(--color-secondary')
  })
})
