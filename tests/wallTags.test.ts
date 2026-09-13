import { describe, expect, it } from 'vitest'
import { addTag, gatherByTag, removeTag, tagSuggestions, tagsOn } from '../src/shared/wallTags'
import type { WallItem } from '../src/shared/wallModel'

const note = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

describe('addTag and removeTag', () => {
  it('puts a tag on every picked sticky once whatever its case, skipping other kinds and locked stickies', () => {
    const items = [note('a', { tags: ['Bug'] }), note('b'), note('c', { locked: true }), note('d', { kind: 'shape' })]

    const out = addTag(items, new Set(['a', 'b', 'c', 'd']), '  bug ')

    expect(out.map(i => i.tags)).toStrictEqual([['Bug'], ['bug'], undefined, undefined])
    expect(addTag(out, new Set(['a', 'b']), 'BUG')).toBe(out)
    expect(addTag(out, new Set(['a']), '   ')).toBe(out)
  })

  it('takes a tag off in any case, dropping the list once it empties', () => {
    const items = [note('a', { tags: ['Bug', 'UI'] }), note('b', { tags: ['bug'] })]

    const out = removeTag(items, new Set(['a', 'b']), 'BUG')

    expect(out[0].tags).toStrictEqual(['UI'])
    expect(out[1]).not.toHaveProperty('tags')
    expect(removeTag(out, new Set(['a']), 'bug')).toBe(out)
  })

  it('lists the picked stickies\' tags once each', () => {
    const items = [note('a', { tags: ['UI', 'Bug'] }), note('b', { tags: ['bug', 'Docs'] }), note('c', { tags: ['Other'] })]
    expect(tagsOn(items, new Set(['a', 'b']))).toStrictEqual(['UI', 'Bug', 'Docs'])
  })
})

describe('tagSuggestions', () => {
  it('offers the board\'s tags that match and aren\'t on yet, the ones starting with the words first', () => {
    expect(tagSuggestions(['Debug', 'bugfix', 'UI', 'Bug'], ['bug'], 'bug')).toStrictEqual(['bugfix', 'Debug'])
    expect(tagSuggestions(['b', 'a', 'c'], [], '', 2)).toStrictEqual(['a', 'b'])
  })
})

describe('gatherByTag', () => {
  it('lays each tag\'s stickies in a grid inside a frame named for it, the tags left to right by name', () => {
    const items = [
      note('b1', { tags: ['Bugs'], x: 500, y: 300 }),
      note('i1', { tags: ['Ideas'], x: 0, y: 0 }),
      note('b2', { tags: ['bugs', 'Ideas'], x: 900, y: 900 }),
      note('plain', { x: 2000, y: 2000 })
    ]
    let n = 0

    const { items: out, clusters } = gatherByTag(items, new Set(), () => `frame${++n}`)
    const byId = new Map(out.map(i => [i.id, i]))

    expect(clusters).toBe(2)
    // two stickies a row, a 24 gap between and 40 of frame round them
    expect(byId.get('b1')).toMatchObject({ x: 40, y: 40 })
    expect(byId.get('b2')).toMatchObject({ x: 164, y: 40 })
    expect(byId.get('frame1')).toMatchObject({ kind: 'frame', text: 'Bugs', x: 0, y: 0, width: 304, height: 180, z: -1 })
    // the next tag starts 80 past that frame
    expect(byId.get('i1')).toMatchObject({ x: 424, y: 40 })
    expect(byId.get('frame2')).toMatchObject({ kind: 'frame', text: 'Ideas', x: 384, y: 0, width: 180, height: 180 })
    expect(byId.get('plain')).toMatchObject({ x: 2000, y: 2000 })
  })

  it('moves the frame it made last time instead of adding another, and takes only the picked stickies', () => {
    const items = [
      note('a', { tags: ['Bugs'], x: 300 }),
      note('b', { tags: ['Bugs'], x: 900 }),
      note('f', { kind: 'frame', text: ' bugs ', x: -500, y: -500, z: 5 })
    ]

    const { items: out } = gatherByTag(items, new Set(['a']))

    expect(out).toHaveLength(3)
    expect(out.find(i => i.id === 'f')).toMatchObject({ x: 300, y: 0, width: 180, height: 180, z: -1 })
    expect(out.find(i => i.id === 'a')).toMatchObject({ x: 340, y: 40 })
    expect(out.find(i => i.id === 'b')).toMatchObject({ x: 900 })
  })

  it('leaves the wall alone when nothing picked is tagged', () => {
    const items = [note('a')]
    expect(gatherByTag(items, new Set(['a']))).toStrictEqual({ items, clusters: 0 })
  })
})
