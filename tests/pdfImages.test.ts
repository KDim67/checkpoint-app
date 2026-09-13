import { describe, expect, it } from 'vitest'
import { buildPdf } from '../src/renderer/src/lib/pdfImages'

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
/** one character a byte, so string offsets are byte offsets */
const read = (bytes: Uint8Array): string => Array.from(bytes, b => String.fromCharCode(b)).join('')

describe('buildPdf', () => {
  it('writes a page per image, sized in points, with the image inside', () => {
    const pdf = read(buildPdf([{ jpeg, width: 800, height: 600 }, { jpeg, width: 400, height: 400 }]))
    expect(pdf.startsWith('%PDF-1.4')).toBe(true)
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain('/MediaBox [0 0 600 450]')
    expect(pdf).toContain('/Width 800 /Height 600')
    expect(pdf).toContain(read(jpeg))
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('lays each page\'s words over its picture as invisible text, so they can be selected and searched', () => {
    const pdf = read(buildPdf([{ jpeg, width: 800, height: 600, texts: [{ text: 'Plan (v2) \\ café 東', x: 40, y: 100, size: 20 }] }]))
    expect(pdf).toContain('/BaseFont /Helvetica')
    expect(pdf).toContain('3 Tr')
    expect(pdf).toContain('15 Tf')
    expect(pdf).toContain('1 0 0 1 30 375 Tm')
    expect(pdf).toContain('(Plan \\(v2\\) \\\\ café ?) Tj')
  })

  it('points every cross-reference at the object it names', () => {
    const pdf = read(buildPdf([{ jpeg, width: 10, height: 10 }, { jpeg, width: 20, height: 20 }]))
    // the table's own keyword, not the one inside startxref
    const table = pdf.slice(pdf.lastIndexOf('\nxref\n'))
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n/gm)].map(m => Number(m[1]))

    // the catalogue, the page list, the font, and a page, drawing and image a sheet
    expect(offsets).toHaveLength(9)
    offsets.forEach((offset, i) => expect(pdf.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`)))
    const start = Number(/startxref\s+(\d+)/.exec(pdf)?.[1])
    expect(pdf.slice(start, start + 4)).toBe('xref')
  })
})
