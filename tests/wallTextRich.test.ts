import { describe, expect, it } from 'vitest'
import { listContinuation, restyleBoxes, parseWallLines, parseWallText, plainWallText, serializeWallLines, stripWordStyle, type TextSpan, type WallLine } from '../src/shared/wallText'
import type { WallItem } from '../src/shared/wallModel'

const spansOf = (text: string): TextSpan[] => {
  const [block] = parseWallText(text)
  return block.spans
}

describe('styled words in Wall text', () => {
  it('reads a colour, a size and a font on part of a line', () => {
    expect(spansOf('Plain [big red]{color=#E44332 size=1.5 font=serif} plain')).toStrictEqual([
      { text: 'Plain ' },
      { text: 'big red', color: '#e44332', size: 1.5, font: 'serif' },
      { text: ' plain' }
    ])
  })

  it('reads a link, with or without styles of its own', () => {
    expect(spansOf('See [the docs](https://example.com/docs) now')).toStrictEqual([
      { text: 'See ' }, { text: 'the docs', url: 'https://example.com/docs' }, { text: ' now' }
    ])
    expect(spansOf('[mail me](mailto:a@example.com){color=#5e6ad2}')).toStrictEqual([
      { text: 'mail me', url: 'mailto:a@example.com', color: '#5e6ad2' }
    ])
  })

  it('reads formatting inside a styled span, and a styled span inside formatting', () => {
    expect(spansOf('[**big** word]{size=2}')).toStrictEqual([{ text: 'big', bold: true, size: 2 }, { text: ' word', size: 2 }])
    expect(spansOf('**a [b]{color=#ff0000} c**')).toStrictEqual([
      { text: 'a ', bold: true }, { text: 'b', bold: true, color: '#ff0000' }, { text: ' c', bold: true }
    ])
  })

  it('leaves brackets that aren\'t a well-formed span as they were written', () => {
    for (const text of ['[draft]', '[x](not a url)', '[x]{color=red}', '[x]{size=99}', '[x]{font=papyrus}', '[]{color=#ffffff}', 'a [b c']) {
      expect(plainWallText(text)).toBe(text)
    }
  })

  it('aligns a line on its own, list lines included', () => {
    const [title, item, plain] = parseWallText('{align=center}Title\n{align=right}- item\nplain')
    expect(title).toMatchObject({ type: 'paragraph', align: 'center', spans: [{ text: 'Title' }] })
    expect(item).toMatchObject({ type: 'bullet', align: 'right', spans: [{ text: 'item' }] })
    expect(plain).not.toHaveProperty('align')
  })

  it('reads as plain words for exports, search and CSV', () => {
    expect(plainWallText('{align=center}[**Hi**]{color=#ff0000} [there](https://x.example)')).toBe('Hi there')
  })
})

describe('the lines the editor holds', () => {
  it('keep list markers and indentation as typed, and leave bare addresses as text', () => {
    expect(parseWallLines('  1) first\n* [b]{size=2}\nsee https://x.example')).toStrictEqual([
      { runs: [{ text: '  1) first' }] },
      { runs: [{ text: '* ' }, { text: 'b', size: 2 }] },
      { runs: [{ text: 'see https://x.example' }] }
    ])
  })

  it('carry a line\'s alignment', () => {
    expect(parseWallLines('{align=right}x')).toStrictEqual([{ align: 'right', runs: [{ text: 'x' }] }])
  })
})

describe('writing the editor\'s lines back', () => {
  const line = (...runs: TextSpan[]): WallLine => ({ runs })

  it('nests markers the way Ctrl+B and friends do, keeping spaces outside them', () => {
    expect(serializeWallLines([line({ text: 'a ' }, { text: 'bold ', bold: true }, { text: 'both', bold: true, italic: true }, { text: '.' })]))
      .toBe('a **bold** **_both_**.')
  })

  it('wraps styled and linked words in a span outside their markers', () => {
    expect(serializeWallLines([line({ text: 'big', bold: true, size: 2, color: '#e44332' }, { text: ' word', size: 2, color: '#e44332' })]))
      .toBe('[**big** word]{color=#e44332 size=2}')
    expect(serializeWallLines([line({ text: 'docs', url: 'https://x.example', font: 'mono' })])).toBe('[docs](https://x.example){font=mono}')
  })

  it('writes alignment at the start of its line', () => {
    expect(serializeWallLines([{ align: 'center', runs: [{ text: 'Title' }] }, line({ text: 'body' })])).toBe('{align=center}Title\nbody')
  })

  it('italicises next to a letter with the marker that still reads as italic there', () => {
    const text = serializeWallLines([line({ text: 'snake' }, { text: 'case', italic: true }, { text: 'd' })])
    expect(parseWallLines(text)[0].runs).toStrictEqual([{ text: 'snake' }, { text: 'case', italic: true }, { text: 'd' }])
  })

  it('reads back exactly what it wrote, for any mix of formatting', () => {
    // a small fixed-seed generator, so a failure names the same case every run
    let seed = 7
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]
    const pieces = ['a', 'bc', 'word', ' ', ' x ', '.', ', ', 'it', '-', '9']
    const normal = (runs: TextSpan[]): TextSpan[] => serializeAndRead(runs)
    const serializeAndRead = (runs: TextSpan[]): TextSpan[] => parseWallLines(serializeWallLines([{ runs }]))[0].runs

    for (let n = 0; n < 3000; n++) {
      const runs: TextSpan[] = []
      const count = 1 + Math.floor(random() * 5)
      for (let i = 0; i < count; i++) {
        const span: TextSpan = { text: pick(pieces) }
        if (random() < 0.4) span.bold = true
        if (random() < 0.4) span.italic = true
        if (random() < 0.2) span.strike = true
        if (random() < 0.2) span.underline = true
        if (random() < 0.15) span.code = true
        if (random() < 0.2) span.color = pick(['#e44332', '#5e6ad2'])
        if (random() < 0.15) span.size = pick([0.5, 2])
        if (random() < 0.1) span.font = 'serif'
        if (random() < 0.1) span.url = 'https://x.example'
        runs.push(span)
      }
      // the first read settles what spaces and empty formatting mean; after that writing and reading change nothing
      const settled = normal(runs)
      expect(serializeAndRead(settled), JSON.stringify(runs)).toStrictEqual(settled)
      expect(settled.map(s => s.text).join(''), JSON.stringify(runs)).toBe(runs.map(s => s.text).join(''))
    }
  })
})

describe('clearing one style from every word', () => {
  it('takes colours or fonts off, leaving the rest, and leaves text without them untouched', () => {
    expect(stripWordStyle('a [b]{color=#ff0000 size=2} [c]{color=#00ff00}', 'color')).toBe('a [b]{size=2} c')
    expect(stripWordStyle('[x]{font=serif}', 'font')).toBe('x')
    const untouched = '*old style* stays exactly as written'
    expect(stripWordStyle(untouched, 'color')).toBe(untouched)
  })
})

describe('Enter in a list line, for the editor', () => {
  it('starts the next item with the same marker, counts on, and leaves the list from an empty item', () => {
    expect(listContinuation('- milk', 6)).toStrictEqual({ prefix: '- ' })
    expect(listContinuation('  9) step', 9)).toStrictEqual({ prefix: '  10) ' })
    expect(listContinuation('* ', 2)).toBe('leave')
    expect(listContinuation('plain', 5)).toBeNull()
    expect(listContinuation('- milk', 1)).toBeNull()
  })
})

describe('a whole box restyled', () => {
  const box = (over: Partial<WallItem>): WallItem => ({ id: 'a', kind: 'text', x: 0, y: 0, width: 100, height: 40, z: 0, ...over } as WallItem)

  it('recolours a text box\'s words, clearing their own colours, but leaves word colours on a sticky, whose colour is its paper', () => {
    const items = [
      box({ id: 't', text: 'a [b]{color=#ff0000 size=2}' }),
      box({ id: 'n', kind: 'note', text: '[b]{color=#ff0000}' }),
      box({ id: 'l', text: '[b]{color=#ff0000}', locked: true })
    ]
    const next = restyleBoxes(items, new Set(['t', 'n', 'l']), { color: '#5e6ad2' }, 'color')
    expect(next.map(i => [i.color, i.text])).toStrictEqual([
      ['#5e6ad2', 'a [b]{size=2}'], ['#5e6ad2', '[b]{color=#ff0000}'], [undefined, '[b]{color=#ff0000}']
    ])
  })

  it('sets every box\'s font, clearing the fonts of single words in any of them', () => {
    const next = restyleBoxes([box({ kind: 'shape', text: '[b]{font=mono}' })], new Set(['a']), { font: 'serif' }, 'font')
    expect(next[0]).toMatchObject({ font: 'serif', text: 'b' })
  })
})
