/** spreadsheet cells pasted onto the wall: telling them from other text, and laying out a sticky each */

import { createWallItem, DEFAULT_SIZES, WALL_COLORS, type WallItem } from '../../../shared/wallModel'

/** past this it's a data dump, not a board of stickies */
export const MAX_CELLS = 200
const CELL_GAP = 16

/** tab separated rows as spreadsheets write them; a cell holding a tab, quote or line break comes quoted */
export function parseTsv(text: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n')
  // the break after the last row ends that row, it doesn't open another
  const body = source.endsWith('\n') ? source.slice(0, -1) : source
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (body[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  row.push(cell)
  rows.push(row)
  return rows
}

/** null for a page holding more than the one table */
function tableRows(html: string): string[][] | null {
  const tables = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('table')
  if (tables.length !== 1) return null
  return Array.from(tables[0].rows, row => Array.from(row.cells, cell => cell.textContent ?? ''))
}

/** whitespace aside, a cell's line break is a <br> in the html */
const letters = (rows: string[][]): string => rows.flat().join('').replace(/\s+/g, '')

/** the grid when the paste came from a spreadsheet: its html is only the table, or tabs line the text up in columns */
export function pastedCells(text: string, html: string): string[][] | null {
  const rows = parseTsv(text)
  if (rows.flat().filter(cell => cell.trim()).length < 2) return null

  const table = html.includes('<table') ? tableRows(html) : null
  if (table && letters(table) === letters(rows)) return rows
  // ragged rows are indented code or prose, not a sheet
  return text.includes('\t') && rows[0].length > 1 && rows.every(row => row.length === rows[0].length) ? rows : null
}

/** a sticky a filled cell, in the grid the cells sat in and centred on the point; one colour so the set reads as one */
export function cellStickies(rows: string[][], at: { x: number; y: number }, items: WallItem[]): WallItem[] {
  const { width, height } = DEFAULT_SIZES.note
  // reduce, a spread of a long paste's rows can overflow the argument limit
  const columns = rows.reduce((most, row) => Math.max(most, row.length), 0)
  const left = at.x - (columns * width + (columns - 1) * CELL_GAP) / 2
  const top = at.y - (rows.length * height + (rows.length - 1) * CELL_GAP) / 2
  const color = WALL_COLORS[items.length % WALL_COLORS.length]

  const made: WallItem[] = []
  rows.forEach((row, r) => row.forEach((cell, c) => {
    const text = cell.trim()
    if (!text) return
    made.push(createWallItem('note', {
      x: left + c * (width + CELL_GAP) + width / 2,
      y: top + r * (height + CELL_GAP) + height / 2
    }, [...items, ...made], { text, color }))
  }))
  return made
}
