// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cellStickies, parseTsv, pastedCells } from '../src/renderer/src/lib/wallCells'
import { DEFAULT_SIZES } from '../src/shared/wallModel'

describe('parseTsv', () => {
  it('splits rows and cells, ignoring the line break a spreadsheet puts after the last row', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toStrictEqual([['a', 'b'], ['c', 'd']])
  })

  it('reads quoted cells holding line breaks, tabs and doubled quotes', () => {
    expect(parseTsv('"one\ntwo"\t"say ""hi"""\nx\t"a\tb"')).toStrictEqual([['one\ntwo', 'say "hi"'], ['x', 'a\tb']])
  })

  it('keeps a quote inside a cell that did not start with one', () => {
    expect(parseTsv('5" nail\tx')).toStrictEqual([['5" nail', 'x']])
  })
})

describe('pastedCells', () => {
  it('takes tab separated rows that line up in columns', () => {
    expect(pastedCells('a\tb\nc\td\n', '')).toStrictEqual([['a', 'b'], ['c', 'd']])
  })

  it('takes a single column when the html is only that table', () => {
    const html = '<meta charset="utf-8"><table><tr><td>one</td></tr><tr><td>two</td></tr></table>'
    expect(pastedCells('one\r\ntwo\r\n', html)).toStrictEqual([['one'], ['two']])
  })

  it('leaves prose, ragged tab indents, a lone cell and a page with a table among other words', () => {
    expect(pastedCells('first line\nsecond line', '')).toBeNull()
    expect(pastedCells('if (x) {\n\treturn 1\n}', '')).toBeNull()
    expect(pastedCells('only\t', '')).toBeNull()
    const page = '<p>Intro</p><table><tr><td>one</td></tr><tr><td>two</td></tr></table>'
    expect(pastedCells('Intro\none\ntwo', page)).toBeNull()
  })
})

describe('cellStickies', () => {
  it('makes a sticky a filled cell, in the grid the cells sat in, centred on the paste point', () => {
    const made = cellStickies([[' a ', 'b'], ['', 'd']], { x: 0, y: 0 }, [])
    const { width, height } = DEFAULT_SIZES.note
    const gap = made[1].x - made[0].x - width

    expect(made.map(i => i.text)).toStrictEqual(['a', 'b', 'd'])
    expect(made.every(i => i.kind === 'note' && i.color === made[0].color)).toBe(true)
    expect(gap).toBeGreaterThan(0)
    expect(made[0]).toMatchObject({ x: -(width + gap / 2), y: -(height + gap / 2) })
    expect(made[2]).toMatchObject({ x: made[1].x, y: made[0].y + height + gap })
    expect(new Set(made.map(i => i.id)).size).toBe(3)
  })
})
