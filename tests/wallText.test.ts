import { describe, it, expect } from 'vitest'
import { continueList, indentLines, parseWallText, plainWallText, toggleWrap } from '../src/shared/wallText'

describe('parseWallText', () => {
  it('reads bold, italic, strikethrough and code', () => {
    expect(parseWallText('a **b** _c_ *d* ~~e~~ `f`')).toEqual([{
      type: 'paragraph',
      spans: [
        { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' },
        { text: 'd', italic: true }, { text: ' ' }, { text: 'e', strike: true }, { text: ' ' }, { text: 'f', code: true }
      ]
    }])
  })

  it('leaves snake_case, a lone asterisk and an unclosed marker as written', () => {
    const text = 'snake_case_name and 2 * 3 and **open'
    expect(parseWallText(text)).toEqual([{ type: 'paragraph', spans: [{ text }] }])
  })

  it('keeps markers inside code literal', () => {
    expect(parseWallText('`a*b*c`')).toEqual([{ type: 'paragraph', spans: [{ text: 'a*b*c', code: true }] }])
  })

  it('nests italic inside bold', () => {
    expect(parseWallText('**bold _both_**')).toEqual([{
      type: 'paragraph',
      spans: [{ text: 'bold ', bold: true }, { text: 'both', bold: true, italic: true }]
    }])
  })

  it('marks addresses, keeping the style around them, but not inside code', () => {
    expect(parseWallText('**see https://example.com/x**')).toEqual([{
      type: 'paragraph',
      spans: [{ text: 'see ', bold: true }, { text: 'https://example.com/x', bold: true, url: 'https://example.com/x' }]
    }])
    expect(parseWallText('`https://example.com`')).toEqual([{
      type: 'paragraph', spans: [{ text: 'https://example.com', code: true }]
    }])
  })

  it('reads bullets by depth and numbered items by their number', () => {
    expect(parseWallText('- one\n  - two\n* three\n3. four\n1) five\nplain')).toEqual([
      { type: 'bullet', depth: 0, spans: [{ text: 'one' }] },
      { type: 'bullet', depth: 1, spans: [{ text: 'two' }] },
      { type: 'bullet', depth: 0, spans: [{ text: 'three' }] },
      { type: 'number', depth: 0, number: 3, spans: [{ text: 'four' }] },
      { type: 'number', depth: 0, number: 1, spans: [{ text: 'five' }] },
      { type: 'paragraph', spans: [{ text: 'plain' }] }
    ])
  })

  it('needs a space after a list marker, and keeps blank lines', () => {
    expect(parseWallText('-no\n\n1.5 kg\r\nlast')).toEqual([
      { type: 'paragraph', spans: [{ text: '-no' }] },
      { type: 'paragraph', spans: [] },
      { type: 'paragraph', spans: [{ text: '1.5 kg' }] },
      { type: 'paragraph', spans: [{ text: 'last' }] }
    ])
  })
})

describe('plainWallText', () => {
  it('drops the markers and keeps list markers readable', () => {
    expect(plainWallText('**Bold** and _it_\n- item\n  - deeper\n2. next')).toBe('Bold and it\n• item\n  • deeper\n2. next')
  })
})

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(toggleWrap('make bold', 5, 9, '**')).toEqual({ value: 'make **bold**', start: 7, end: 11 })
  })

  it('unwraps when the markers sit just outside the selection', () => {
    expect(toggleWrap('make **bold**', 7, 11, '**')).toEqual({ value: 'make bold', start: 5, end: 9 })
  })

  it('unwraps when the selection takes the markers in', () => {
    expect(toggleWrap('make **bold**', 5, 13, '**')).toEqual({ value: 'make bold', start: 5, end: 9 })
  })

  it('puts the caret between a new pair when nothing is selected', () => {
    expect(toggleWrap('ab', 1, 1, '_')).toEqual({ value: 'a__b', start: 2, end: 2 })
  })
})

describe('indentLines', () => {
  it('indents every line the selection touches by one level', () => {
    expect(indentLines('- a\n- b', 0, 7, false)).toEqual({ value: '  - a\n  - b', start: 2, end: 11 })
  })

  it('outdents only the lines touched, by at most one level', () => {
    expect(indentLines('  - a\n - b', 4, 4, true)).toEqual({ value: '- a\n - b', start: 2, end: 2 })
    expect(indentLines(' - b', 2, 2, true)).toEqual({ value: '- b', start: 1, end: 1 })
  })

  it('never moves the caret past the start of its line', () => {
    expect(indentLines('  - a', 1, 1, true)).toEqual({ value: '- a', start: 0, end: 0 })
  })
})

describe('continueList', () => {
  it('continues a bullet at the same depth', () => {
    expect(continueList('  - one', 7)).toEqual({ value: '  - one\n  - ', caret: 12 })
  })

  it('counts a numbered list up', () => {
    expect(continueList('1. one', 6)).toEqual({ value: '1. one\n2. ', caret: 10 })
  })

  it('splits an item when the caret is mid-line', () => {
    expect(continueList('- onetwo', 5)).toEqual({ value: '- one\n- two', caret: 8 })
  })

  it('ends the list on an empty item', () => {
    expect(continueList('- one\n- ', 8)).toEqual({ value: '- one\n', caret: 6 })
  })

  it('leaves Enter alone outside a list', () => {
    expect(continueList('plain', 5)).toBeNull()
  })
})
