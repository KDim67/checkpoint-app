import { describe, it, expect } from 'vitest'
import { cardFromText, shapeOutline, shapeTextBox, switchKinds } from '../src/shared/wallShape'
import { DEFAULT_SIZES, type WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem => ({
  id, kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, ...over
})

describe('shapeOutline', () => {
  it('draws each shape inside its box, a pixel in so the border is not clipped', () => {
    expect(shapeOutline('rectangle', 100, 50)).toBe('M1,1H99V49H1Z')
    expect(shapeOutline('diamond', 100, 50)).toBe('M50,1L99,25L50,49L1,25Z')
    expect(shapeOutline('triangle', 100, 50)).toBe('M50,1L99,49L1,49Z')
  })

  it('rounds corners no deeper than a quarter of the shorter side', () => {
    // 98 by 38 inside the border, so the corner is 9.5
    expect(shapeOutline('rounded', 100, 40).startsWith('M10.5,1H89.5')).toBe(true)
  })

  it('draws an oval as two arcs across the box', () => {
    expect(shapeOutline('oval', 100, 50)).toBe('M1,25A49,24 0 1 0 99,25A49,24 0 1 0 1,25Z')
  })
})

describe('shapeTextBox', () => {
  it('keeps words inside the narrow parts of a diamond and a triangle', () => {
    expect(shapeTextBox('rectangle')).toEqual({ top: 8, right: 8, bottom: 8, left: 8 })
    expect(shapeTextBox('diamond')).toEqual({ top: 25, right: 25, bottom: 25, left: 25 })
    // the point is at the top, the room is at the bottom
    expect(shapeTextBox('triangle').top).toBeGreaterThan(shapeTextBox('triangle').bottom)
  })
})

describe('switchKinds', () => {
  it('turns a sticky into a shape keeping its box, colour, words, link and id', () => {
    const [shape] = switchKinds(
      [item('a', { color: '#f28b82', text: 'Hi', link: 'https://example.com/', x: 10, y: 20 })],
      new Set(['a']),
      'shape'
    )
    expect(shape).toEqual({
      id: 'a', kind: 'shape', x: 10, y: 20, width: 200, height: 200, z: 0,
      color: '#f28b82', text: 'Hi', link: 'https://example.com/'
    })
  })

  it('drops the outline when a shape becomes a sticky, and keeps the colour', () => {
    const [note] = switchKinds([item('a', { kind: 'shape', shape: 'oval', color: '#a7c7e7' })], new Set(['a']), 'note')
    expect(note.kind).toBe('note')
    expect(note).not.toHaveProperty('shape')
    expect(note.color).toBe('#a7c7e7')
  })

  it('drops the fill when a sticky becomes text, it would turn into the text colour', () => {
    const [text] = switchKinds([item('a', { color: '#f6c453', text: 'Hi' })], new Set(['a']), 'text')
    expect(text).toMatchObject({ kind: 'text', width: 200, text: 'Hi' })
    expect(text).not.toHaveProperty('color')
  })

  it('gives text that becomes a sticky the sticky\'s size, around the same centre', () => {
    const [note] = switchKinds(
      [item('a', { kind: 'text', width: 240, height: 32, color: '#ffffff' })],
      new Set(['a']),
      'note'
    )
    expect(note).toMatchObject({ width: DEFAULT_SIZES.note.width, height: DEFAULT_SIZES.note.height, x: 20, y: -84 })
    expect(note).not.toHaveProperty('color')
  })

  it('leaves cards, locked items and anything unselected as they are', () => {
    const items = [item('c', { kind: 'card', ref: 'card-1' }), item('l', { locked: true }), item('u')]
    expect(switchKinds(items, new Set(['c', 'l']), 'shape')).toEqual(items)
  })
})

describe('cardFromText', () => {
  it('takes the first line for the title and keeps the rest as written for the description', () => {
    expect(cardFromText('**Fix login**\n- repro on Safari\n- add a test')).toEqual({
      title: 'Fix login', body: '- repro on Safari\n- add a test'
    })
  })

  it('skips blank lines and a list marker to find the title', () => {
    expect(cardFromText('\n\n- only item')).toEqual({ title: 'only item', body: '' })
  })

  it('names an empty sticky the way the board names a new card', () => {
    expect(cardFromText('')).toEqual({ title: 'New card', body: '' })
  })

  it('keeps a long first line to a title\'s length', () => {
    expect(cardFromText('x'.repeat(500)).title).toHaveLength(200)
  })
})
