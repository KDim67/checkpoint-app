import { describe, expect, it } from 'vitest'
import { wallToSvg } from '../src/renderer/src/lib/wallSvg'
import { wrapLines } from '../src/renderer/src/lib/wallWrap'
import type { WallItem } from '../src/shared/wallModel'

const item = (id: string, over: Partial<WallItem> = {}): WallItem =>
  ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, ...over })

const base = {
  titleOf: (i: WallItem): string | undefined => i.text,
  background: '#101010',
  textColor: '#ffffff',
  surfaceColor: '#202020',
  borderColor: '#303030',
  measure: (s: string): number => s.length * 7,
  imageData: (): string | undefined => undefined
}

describe('wrapLines', () => {
  it('breaks at spaces to fit, keeping written line breaks', () => {
    expect(wrapLines('one two three\nfour', 60, s => s.length * 10)).toStrictEqual(['one', 'two', 'three', 'four'])
  })
})

describe('wallToSvg', () => {
  it('sizes the drawing to the items with a margin and paints the background', () => {
    const svg = wallToSvg([item('a', { x: 100, y: 50, width: 200, height: 100, text: 'hi' })], base) ?? ''
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="280" height="180" viewBox="60 10 280 180"/)
    expect(svg).toContain('fill="#101010"')
  })

  it('writes words as escaped text, and draws shapes, highlighter ink, images and labelled arrows', () => {
    const items = [
      item('n', { width: 300, text: 'a < b & "c"' }),
      item('s', { kind: 'shape', shape: 'oval', x: 300, text: 'Go' }),
      item('m', { kind: 'ink', points: [0, 0, 50, 50], y: 300, width: 66, height: 66, highlight: true }),
      item('img', { kind: 'image', ref: 'p.png', x: 500 }),
      item('line', { kind: 'arrow', from: 'n', to: 's', text: 'next' })
    ]
    const svg = wallToSvg(items, { ...base, imageData: ref => (ref === 'p.png' ? 'data:image/png;base64,AAAA' : undefined) }) ?? ''

    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;')
    expect(svg).toContain('>Go<')
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
    expect(svg).toContain('opacity="0.4"')
    expect(svg).toContain('>next<')
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('draws nothing for an empty wall', () => {
    expect(wallToSvg([], base)).toBeNull()
  })
})
