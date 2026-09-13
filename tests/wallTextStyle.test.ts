import { describe, expect, it } from 'vitest'
import { parseWallText, plainWallText, toggleWrap } from '../src/shared/wallText'
import { shapeOutline, textAlignOf } from '../src/shared/wallShape'
import { normalizeWallDoc, normalizeWallItem, type WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const read = (raw: Record<string, unknown>): WallItem => {
  const normalized = normalizeWallItem(raw, 0)
  if (!normalized) throw new Error('dropped')
  return normalized
}

describe('underline', () => {
  it('reads ++words++ as underlined, alone or with other styles', () => {
    expect(parseWallText('a ++b++ c')[0].spans).toStrictEqual([{ text: 'a ' }, { text: 'b', underline: true }, { text: ' c' }])
    expect(parseWallText('**++both++**')[0].spans).toStrictEqual([{ text: 'both', bold: true, underline: true }])
    expect(plainWallText('++under++ line')).toBe('under line')
  })

  it('leaves plus signs that aren\'t wrapped round words alone', () => {
    expect(parseWallText('1 ++ 2')[0].spans).toStrictEqual([{ text: '1 ++ 2' }])
  })

  it('wraps a selection', () => {
    expect(toggleWrap('make line', 5, 9, '++')).toStrictEqual({ value: 'make ++line++', start: 7, end: 11 })
  })
})

describe('text alignment', () => {
  it('sits left for words and centred in a shape, unless a side was chosen', () => {
    expect(textAlignOf(item('n'))).toBe('left')
    expect(textAlignOf(item('s', { kind: 'shape' }))).toBe('center')
    expect(textAlignOf(item('n', { align: 'right' }))).toBe('right')
  })

  it('stores a side only on items with words, and only when it isn\'t their default', () => {
    expect(read({ kind: 'note', align: 'center' }).align).toBe('center')
    expect(read({ kind: 'note', align: 'left' })).not.toHaveProperty('align')
    expect(read({ kind: 'shape', align: 'center' })).not.toHaveProperty('align')
    expect(read({ kind: 'frame', align: 'right' })).not.toHaveProperty('align')
    expect(read({ kind: 'text', align: 'justify' })).not.toHaveProperty('align')
  })
})

describe('shape style', () => {
  it('keeps a border colour, corner radius and fill opacity on shapes, within range', () => {
    expect(read({ kind: 'shape', borderColor: '#f28b82', radius: 300, opacity: 0.02 })).toMatchObject({ borderColor: '#f28b82', radius: 200, opacity: 0.1 })
    expect(read({ kind: 'shape', radius: -4 })).toMatchObject({ radius: 0 })
    expect(read({ kind: 'shape', opacity: 1 })).not.toHaveProperty('opacity')

    const note = read({ kind: 'note', borderColor: '#000000', radius: 8, opacity: 0.5 })
    expect(note).not.toHaveProperty('borderColor')
    expect(note).not.toHaveProperty('radius')
    expect(note).not.toHaveProperty('opacity')
  })

  it('rounds a rounded shape by the radius given, never past half its short side', () => {
    expect(shapeOutline('rounded', 100, 50, 10)).toBe('M11,1H89Q99,1 99,11V39Q99,49 89,49H11Q1,49 1,39V11Q1,1 11,1Z')
    expect(shapeOutline('rounded', 100, 50, 999)).toBe(shapeOutline('rounded', 100, 50, 24))
  })
})

describe('frame order', () => {
  it('keeps a stored order of frame ids, each once', () => {
    expect(normalizeWallDoc({ items: [], frameOrder: ['b', 'a', 'b', 7, ''] }).frameOrder).toStrictEqual(['b', 'a'])
    expect(normalizeWallDoc({ items: [] })).not.toHaveProperty('frameOrder')
  })
})
