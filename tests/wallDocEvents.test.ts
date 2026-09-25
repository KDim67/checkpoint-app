// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushWallDoc,
  saveWallDoc,
  saveWallIndex,
  WALL_DOC_EVENT,
  WALL_INDEX_EVENT
} from '../src/renderer/src/lib/wallDoc'
import { normalizeWallDoc, normalizeWallIndex, type WallDoc, type WallIndex } from '../src/shared/wallModel'

vi.mock('../src/renderer/src/data/settings', () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  deleteSetting: vi.fn(async () => {})
}))

describe('wallDoc event dispatching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  const sampleDoc: WallDoc = normalizeWallDoc({
    version: 1,
    camera: { x: 0, y: 0, zoom: 1 },
    items: []
  })

  const sampleIndex: WallIndex = normalizeWallIndex({
    activeId: 'default',
    walls: [{ id: 'default', name: 'Wall' }]
  })

  it('dispatches WALL_DOC_EVENT on flushWallDoc when context and wallId provided', async () => {
    const listener = vi.fn()
    window.addEventListener(WALL_DOC_EVENT, listener)

    await flushWallDoc('wall_test', sampleDoc, { context: 'test', wallId: 'default' })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toMatchObject({
      context: 'test',
      wallId: 'default',
      doc: sampleDoc
    })

    window.removeEventListener(WALL_DOC_EVENT, listener)
  })

  it('suppresses WALL_DOC_EVENT when skipBroadcast is true', async () => {
    const listener = vi.fn()
    window.addEventListener(WALL_DOC_EVENT, listener)

    await flushWallDoc('wall_test', sampleDoc, { context: 'test', wallId: 'default', skipBroadcast: true })

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(WALL_DOC_EVENT, listener)
  })

  it('dispatches WALL_DOC_EVENT after debounce on saveWallDoc', async () => {
    const listener = vi.fn()
    window.addEventListener(WALL_DOC_EVENT, listener)

    saveWallDoc('wall_test', sampleDoc, { context: 'test', wallId: 'default' })
    expect(listener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(450)

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toMatchObject({
      context: 'test',
      wallId: 'default'
    })

    window.removeEventListener(WALL_DOC_EVENT, listener)
  })

  it('dispatches WALL_INDEX_EVENT on saveWallIndex', async () => {
    const listener = vi.fn()
    window.addEventListener(WALL_INDEX_EVENT, listener)

    await saveWallIndex('test', sampleIndex)

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toMatchObject({
      context: 'test',
      index: sampleIndex
    })

    window.removeEventListener(WALL_INDEX_EVENT, listener)
  })

  it('suppresses WALL_INDEX_EVENT when skipBroadcast is true', async () => {
    const listener = vi.fn()
    window.addEventListener(WALL_INDEX_EVENT, listener)

    await saveWallIndex('test', sampleIndex, { skipBroadcast: true })

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(WALL_INDEX_EVENT, listener)
  })
})
