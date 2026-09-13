import { describe, it, expect } from 'vitest'
import {
  applyStyle,
  clipSelection,
  clipText,
  decodeClip,
  encodeClip,
  placeClip,
  styleOf,
  type WallClip
} from '../src/shared/wallClipboard'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem => ({
  id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over
})

const arrow = (id: string, over: Partial<WallItem> = {}): WallItem => item(id, { kind: 'arrow', width: 1, height: 1, ...over })

/** reproducible ids for the placed copies */
const counter = (): (() => string) => {
  let n = 0
  return () => `new${++n}`
}

const idsOf = (items: WallItem[] | undefined): string[] => (items ?? []).map(i => i.id)

describe('clipSelection', () => {
  it('copies the selection and everything inside a selected frame', () => {
    const frame = item('f', { kind: 'frame', width: 400, height: 400, z: 0 })
    const inside = item('in', { x: 50, y: 50, z: 1 })
    const outside = item('out', { x: 900, y: 900, z: 2 })

    expect(idsOf(clipSelection([frame, inside, outside], new Set(['f']))?.items)).toEqual(['f', 'in'])
  })

  it('brings a connector along only when both of its items come', () => {
    const a = item('a', { z: 1 })
    const b = item('b', { x: 300, z: 2 })
    const c = item('c', { x: 600, z: 3 })
    const ab = arrow('ab', { from: 'a', to: 'b', z: 4 })
    const bc = arrow('bc', { from: 'b', to: 'c', z: 5 })

    expect(idsOf(clipSelection([a, b, c, ab, bc], new Set(['a', 'b']))?.items)).toEqual(['a', 'b', 'ab'])
  })

  it('keeps a selected connector whose item stays behind, pinned where that item was', () => {
    const a = item('a', { z: 1 })
    const pointer = arrow('ar', { from: 'a', toPoint: { x: 500, y: 50 }, z: 2 })

    const clip = clipSelection([a, pointer], new Set(['ar']))

    expect(clip?.items).toHaveLength(1)
    expect(clip?.items[0]).toMatchObject({ id: 'ar', fromPoint: { x: 50, y: 50 }, toPoint: { x: 500, y: 50 } })
    expect(clip?.items[0].from).toBeUndefined()
  })

  it('unlocks the copies, and copies nothing from an empty selection', () => {
    expect(clipSelection([item('a', { locked: true })], new Set(['a']))?.items[0].locked).toBeUndefined()
    expect(clipSelection([item('a')], new Set())).toBeNull()
  })
})

describe('placeClip', () => {
  it('centres the copies on the point with fresh ids, keeping their layout', () => {
    const clip: WallClip = { version: 1, items: [item('a'), item('b', { x: 200 })] }

    const placed = placeClip(clip, [], { x: 1000, y: 500 }, counter())

    expect(placed.map(i => [i.id, i.x, i.y])).toEqual([['new1', 850, 450], ['new2', 1050, 450]])
  })

  it('reconnects copied connectors to the copies, and moves loose ends with them', () => {
    const clip: WallClip = {
      version: 1,
      items: [
        item('a'),
        item('b', { x: 200 }),
        arrow('ab', { from: 'a', to: 'b' }),
        arrow('lo', { from: 'b', toPoint: { x: 300, y: 50 } })
      ]
    }

    const placed = placeClip(clip, [], { x: 150, y: 150 }, counter())

    expect(placed[2]).toMatchObject({ id: 'new3', from: 'new1', to: 'new2' })
    expect(placed[3]).toMatchObject({ id: 'new4', from: 'new2', toPoint: { x: 300, y: 150 } })
  })

  it('stacks the copies above everything on the wall, in their own order', () => {
    const clip: WallClip = { version: 1, items: [item('top', { z: 5 }), item('bottom', { z: 1 })] }

    const placed = placeClip(clip, [item('e', { z: 7 })], { x: 0, y: 0 }, counter())

    expect(placed.map(i => [i.id, i.z])).toEqual([['new2', 8], ['new1', 9]])
  })

  it('drops a connector whose item is not in the clip', () => {
    const clip: WallClip = { version: 1, items: [item('a'), arrow('ar', { from: 'a', to: 'gone' })] }
    expect(placeClip(clip, [], { x: 0, y: 0 }, counter()).map(i => i.kind)).toEqual(['note'])
  })
})

describe('encodeClip and decodeClip', () => {
  it('round-trips a clip through the clipboard', () => {
    const clip: WallClip = { version: 1, items: [item('a', { text: 'hello' }), item('b', { x: 200 })] }
    expect(decodeClip(encodeClip(clip))).toEqual(clip)
  })

  it('refuses what it did not write', () => {
    expect(decodeClip(null)).toBeNull()
    expect(decodeClip('hello')).toBeNull()
    expect(decodeClip('{"version":2,"items":[]}')).toBeNull()
    expect(decodeClip('{"version":1,"items":[{"kind":"hologram"}]}')).toBeNull()
  })
})

describe('clipText', () => {
  it('gives other apps the words in reading order, with links spelled out', () => {
    const clip: WallClip = {
      version: 1,
      items: [
        item('n', { text: '- ship\n- test', y: 200, link: 'https://example.com/' }),
        item('t', { kind: 'text', text: '**Plan**', y: 0 }),
        item('c', { kind: 'card', ref: 'card-1', y: 400 }),
        item('b', { kind: 'bookmark', text: 'Example', link: 'https://example.com/', y: 600 }),
        item('i', { kind: 'ink', points: [0, 0, 1, 1], y: 800 })
      ]
    }

    expect(clipText(clip, i => (i.kind === 'card' ? 'Fix login' : i.text)))
      .toBe('Plan\n\n• ship\n• test\nhttps://example.com/\n\nFix login\n\nExample\nhttps://example.com/')
  })
})

describe('styleOf and applyStyle', () => {
  it('paints the colour on everything picked and leaves locked items alone', () => {
    const items = [item('a', { color: '#111111' }), item('b', { kind: 'text' }), item('c', { locked: true, color: '#222222' })]

    const out = applyStyle(items, new Set(['a', 'b', 'c']), styleOf(item('src', { color: '#f28b82' })))

    expect(out.map(i => i.color)).toEqual(['#f28b82', '#f28b82', '#222222'])
  })

  it('clears the colour when the source has its kind\'s default', () => {
    expect(applyStyle([item('a', { color: '#111111' })], new Set(['a']), styleOf(item('src')))[0].color).toBeUndefined()
  })

  it('carries arrow looks only to arrows, and line weight to arrows and ink', () => {
    const source = arrow('src', { color: '#000000', strokeWidth: 8, arrowShape: 'elbow', arrowLine: 'dashed' })

    const [connector, ink, note] = applyStyle(
      [arrow('ar', { arrowHeads: 'both' }), item('in', { kind: 'ink', strokeWidth: 2 }), item('no')],
      new Set(['ar', 'in', 'no']),
      styleOf(source)
    )

    expect(connector).toMatchObject({ strokeWidth: 8, arrowShape: 'elbow', arrowLine: 'dashed' })
    // the source had default heads, so the connector does now
    expect(connector.arrowHeads).toBeUndefined()
    expect(ink.strokeWidth).toBe(8)
    expect(note).not.toHaveProperty('arrowShape')
    expect(note).not.toHaveProperty('strokeWidth')
  })
})
