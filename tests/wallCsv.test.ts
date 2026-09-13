import { describe, expect, it } from 'vitest'
import { wallToCsv } from '../src/renderer/src/lib/wallCsv'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

describe('wallToCsv', () => {
  it('writes a row for each item with words, top to bottom, quoting what needs it', () => {
    const csv = wallToCsv([
      item('b', { y: 300, text: 'Second, "quoted"', color: '#f28b82' }),
      item('a', { kind: 'text', x: 50, text: '**Plan**\n- one' }),
      item('c', { kind: 'card', ref: 'card-1', y: 600 }),
      item('ink', { kind: 'ink', points: [0, 0, 5, 5] }),
      item('line', { kind: 'arrow', from: 'a', to: 'b' })
    ], i => (i.kind === 'card' ? 'Ship it' : undefined))

    expect(csv.split('\r\n')).toStrictEqual([
      'Kind,Text,Link,Colour,X,Y,Width,Height,Tags',
      'Text,"Plan\n• one",,,50,0,100,100,',
      'Sticky,"Second, ""quoted""",,#f28b82,0,300,100,100,',
      'Card,Ship it,,,0,600,100,100,',
      ''
    ])
  })

  it('keeps a spreadsheet from running words as a formula', () => {
    const csv = wallToCsv([item('a', { text: '=SUM(A1)', link: 'https://example.com/' })], () => undefined)
    expect(csv.split('\r\n')[1]).toBe("Sticky,'=SUM(A1),https://example.com/,,0,0,100,100,")
  })

  it('keeps a labelled arrow and a named frame', () => {
    const csv = wallToCsv([
      item('f', { kind: 'frame', text: 'Q3' }),
      item('line', { kind: 'arrow', from: 'f', toPoint: { x: 0, y: 0 }, text: 'next', y: 10 })
    ], () => undefined)
    expect(csv.split('\r\n').slice(1, 3)).toStrictEqual(['Frame,Q3,,,0,0,100,100,', 'Arrow,next,,,0,10,100,100,'])
  })

  it('writes a sticky\'s tags in their own column and a code block\'s source as written', () => {
    const csv = wallToCsv([
      item('n', { text: 'Login', tags: ['Bug', 'UI'] }),
      item('c', { kind: 'code', text: '**not bold**', y: 200 })
    ], () => undefined)
    expect(csv.split('\r\n').slice(1, 3)).toStrictEqual(['Sticky,Login,,,0,0,100,100,"Bug, UI"', 'Code,**not bold**,,,0,200,100,100,'])
  })
})
