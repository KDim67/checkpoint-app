/** the wall's words as a spreadsheet: a row an item, top to bottom */

import { plainWallText } from '../../../shared/wallText'
import { parseWallLink } from '../../../shared/wallLink'
import type { WallItem, WallItemKind } from '../../../shared/wallModel'

/** strokes have no words; an arrow only counts once it has a label */
const KIND_NAMES: Partial<Record<WallItemKind, string>> = {
  note: 'Sticky', text: 'Text', shape: 'Shape', frame: 'Frame', card: 'Card',
  doc: 'Note', image: 'Image', bookmark: 'Link', arrow: 'Arrow', code: 'Code'
}

/** a spreadsheet runs a cell that starts like a formula, a leading quote keeps it words */
const defused = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

const cell = (value: string | number): string => {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function wallToCsv(items: WallItem[], titleOf: (item: WallItem) => string | undefined): string {
  const rows = items
    .filter(i => KIND_NAMES[i.kind] && (i.kind !== 'arrow' || !!i.text?.trim()))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(item => {
      const words = item.kind === 'note' || item.kind === 'text' || item.kind === 'shape'
        ? plainWallText(item.text ?? '')
        : item.kind === 'card' || item.kind === 'doc'
          ? titleOf(item) ?? item.ref ?? ''
          : item.text ?? ''
      const link = parseWallLink(item.link)
      return [
        KIND_NAMES[item.kind] as string,
        defused(words.trim()),
        defused(link?.type === 'url' ? link.url : ''),
        item.color ?? '',
        Math.round(item.x),
        Math.round(item.y),
        Math.round(item.width),
        Math.round(item.height),
        defused((item.tags ?? []).join(', '))
      ].map(cell).join(',')
    })

  // CRLF, the line ending spreadsheets expect
  return [['Kind', 'Text', 'Link', 'Colour', 'X', 'Y', 'Width', 'Height', 'Tags'].join(','), ...rows].join('\r\n') + '\r\n'
}
