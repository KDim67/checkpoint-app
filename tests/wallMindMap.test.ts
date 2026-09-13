import { describe, expect, it } from 'vitest'
import { addTopic, layoutMap, mapRoot, mapTree, MAP_GAP_X, MAP_GAP_Y, withBranches } from '../src/shared/wallMindMap'
import type { WallItem } from '../src/shared/wallModel'

const topic = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'shape', shape: 'rounded', map: 'm', x: 0, y: 0, width: 100, height: 40, z: 0, ...over })

const line = (id: string, from: string, to: string, z = 0): WallItem =>
  ({ id, kind: 'arrow', from, to, x: 0, y: 0, width: 1, height: 1, z })

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('expected a value')
  return value
}

describe('mapTree', () => {
  it('reads who hangs from whom from the lines between topics, children top to bottom, ignoring a line that would loop', () => {
    const items = [
      topic('root'), topic('b', { y: 100 }), topic('a', { y: -100 }), topic('c'),
      line('l1', 'root', 'b', 1), line('l2', 'root', 'a', 2), line('l3', 'a', 'c', 3), line('l4', 'c', 'root', 4),
      topic('stray', { map: 'other' }), line('l5', 'root', 'stray', 5)
    ]

    const tree = mapTree(items, 'm')

    expect(tree.roots).toStrictEqual(['root'])
    expect(tree.children.get('root')).toStrictEqual(['a', 'b'])
    expect(tree.parent.get('c')).toBe('a')
    expect(tree.parent.has('root')).toBe(false)
  })
})

describe('layoutMap', () => {
  it('stacks children beside their topic and centred on it, keeping a branch dragged to the left on the left', () => {
    const items = [
      topic('root', { width: 200, height: 80 }),
      topic('a', { x: 500, y: -50 }), topic('b', { x: 500, y: 50 }), topic('l', { x: -500 }), topic('a1', { x: 900 }),
      line('1', 'root', 'a', 1), line('2', 'root', 'b', 2), line('3', 'root', 'l', 3), line('4', 'a', 'a1', 4)
    ]

    const laid = layoutMap(items, 'm')
    const byId = new Map(laid.map(i => [i.id, i]))

    // the right side is two topics and a gap tall, centred on the root's middle at 40
    const top = 40 - (40 + 40 + MAP_GAP_Y) / 2
    expect(byId.get('root')).toMatchObject({ x: 0, y: 0 })
    expect(byId.get('a')).toMatchObject({ x: 200 + MAP_GAP_X, y: top })
    expect(byId.get('b')).toMatchObject({ x: 200 + MAP_GAP_X, y: top + 40 + MAP_GAP_Y })
    expect(byId.get('a1')).toMatchObject({ x: 200 + MAP_GAP_X + 100 + MAP_GAP_X, y: top })
    expect(byId.get('l')).toMatchObject({ x: -MAP_GAP_X - 100, y: 20 })
    expect(layoutMap(laid, 'm')).toBe(laid)
  })
})

describe('addTopic', () => {
  it('adds a child joined by a plain line beside its topic, a sibling just under it, and branches the root to the emptier side', () => {
    const root = mapRoot([], { x: 0, y: 0 }, 'm')

    const first = must(addTopic([root], root.id, 'child'))
    expect(first.topic).toMatchObject({ kind: 'shape', shape: 'rounded', map: 'm', x: -100 + 200 + MAP_GAP_X, y: -24 })
    expect(first.items.find(i => i.kind === 'arrow')).toMatchObject({ from: root.id, to: first.topic.id, arrowHeads: 'none' })

    const second = must(addTopic(first.items, first.topic.id, 'sibling'))
    expect(second.items.find(i => i.id === first.topic.id)?.y).toBe(-24 - (48 + MAP_GAP_Y) / 2)
    expect(second.topic.y).toBe(-24 + (48 + MAP_GAP_Y) / 2)
    expect(mapTree(second.items, 'm').parent.get(second.topic.id)).toBe(root.id)

    const third = must(addTopic(second.items, root.id, 'child'))
    expect(third.topic).toMatchObject({ x: -100 - MAP_GAP_X - 180, y: -24 })

    const colours = [first.topic.color, second.topic.color, third.topic.color]
    expect(new Set(colours).size).toBe(3)
    expect(colours).not.toContain(root.color)

    const deeper = must(addTopic(third.items, first.topic.id, 'child'))
    expect(deeper.topic.color).toBe(first.topic.color)
  })

  it('makes a root\'s sibling its child, and adds nothing to an item that isn\'t a topic', () => {
    const root = mapRoot([], { x: 0, y: 0 }, 'm')
    const added = must(addTopic([root], root.id, 'sibling'))
    expect(mapTree(added.items, 'm').parent.get(added.topic.id)).toBe(root.id)

    expect(addTopic([topic('n', { map: undefined, kind: 'note' })], 'n', 'child')).toBeNull()
  })
})

describe('withBranches', () => {
  it('takes every topic under a picked one', () => {
    const items = [
      topic('root'), topic('a'), topic('a1'), topic('a2'), topic('b'),
      line('1', 'root', 'a'), line('2', 'a', 'a1'), line('3', 'a1', 'a2'), line('4', 'root', 'b')
    ]
    expect([...withBranches(items, new Set(['a']))].sort()).toStrictEqual(['a', 'a1', 'a2'])
  })
})
