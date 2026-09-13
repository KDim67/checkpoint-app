/** wall text stays plain with Notes' markers, so search, export and the assistant read it as written */

import { linkSegments } from './wallLink'

export interface TextSpan {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  url?: string
}

export type TextBlock =
  | { type: 'paragraph'; spans: TextSpan[] }
  | { type: 'bullet'; depth: number; spans: TextSpan[] }
  | { type: 'number'; depth: number; number: number; spans: TextSpan[] }

type Style = Omit<TextSpan, 'text' | 'url'>

// code first so its contents stay literal; an underscore needs a non-word edge, snake_case isn't italic
const INLINE = /`([^`\n]+)`|\*\*(?=\S)([\s\S]*?\S)\*\*|~~(?=\S)([\s\S]*?\S)~~|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g

function styled(text: string, style: Style): TextSpan[] {
  if (!text) return []
  // an address in code is code, not a link
  if (style.code) return [{ text, ...style }]
  return linkSegments(text).map(s => (s.url ? { text: s.text, ...style, url: s.url } : { text: s.text, ...style }))
}

const sameStyle = (a: TextSpan, b: TextSpan): boolean =>
  !a.url && !b.url && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code

/** neighbours with one style become one span, the renderer draws fewer nodes */
function merge(spans: TextSpan[]): TextSpan[] {
  const out: TextSpan[] = []
  for (const span of spans) {
    const previous = out[out.length - 1]
    if (previous && sameStyle(previous, span)) previous.text += span.text
    else out.push({ ...span })
  }
  return out
}

function inline(text: string, style: Style = {}): TextSpan[] {
  const out: TextSpan[] = []
  let last = 0

  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0
    out.push(...styled(text.slice(last, start), style))
    if (m[1] !== undefined) out.push(...styled(m[1], { ...style, code: true }))
    else if (m[2] !== undefined) out.push(...inline(m[2], { ...style, bold: true }))
    else if (m[3] !== undefined) out.push(...inline(m[3], { ...style, strike: true }))
    else out.push(...inline(m[4] ?? m[5], { ...style, italic: true }))
    last = start + m[0].length
  }

  out.push(...styled(text.slice(last), style))
  return merge(out)
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/

/** two spaces or a tab a level */
const depthOf = (indent: string): number => Math.floor(indent.replace(/\t/g, '  ').length / 2)

export function parseWallText(text: string): TextBlock[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line): TextBlock => {
    const bullet = BULLET.exec(line)
    if (bullet) return { type: 'bullet', depth: depthOf(bullet[1]), spans: inline(bullet[2]) }
    const numbered = NUMBERED.exec(line)
    if (numbered) {
      return { type: 'number', depth: depthOf(numbered[1]), number: Number(numbered[2]), spans: inline(numbered[3]) }
    }
    return { type: 'paragraph', spans: inline(line) }
  })
}

/** for the PNG export, which can't draw styles */
export function plainWallText(text: string): string {
  return parseWallText(text).map(block => {
    const words = block.spans.map(s => s.text).join('')
    if (block.type === 'paragraph') return words
    const marker = block.type === 'bullet' ? '•' : `${block.number}.`
    return `${'  '.repeat(block.depth)}${marker} ${words}`
  }).join('\n')
}

interface Edit {
  value: string
  start: number
  end: number
}

/** Ctrl+B and friends; the words stay selected and the markers sit outside them */
export function toggleWrap(value: string, start: number, end: number, marker: string): Edit {
  const n = marker.length
  const selected = value.slice(start, end)

  if (start >= n && value.slice(start - n, start) === marker && value.slice(end, end + n) === marker) {
    return { value: value.slice(0, start - n) + selected + value.slice(end + n), start: start - n, end: end - n }
  }
  if (selected.length >= n * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    return { value: value.slice(0, start) + selected.slice(n, -n) + value.slice(end), start, end: end - n * 2 }
  }
  return { value: value.slice(0, start) + marker + selected + marker + value.slice(end), start: start + n, end: end + n }
}

const lineStartOf = (value: string, at: number): number => (at === 0 ? 0 : value.lastIndexOf('\n', at - 1) + 1)

const lineEndOf = (value: string, at: number): number => {
  const next = value.indexOf('\n', at)
  return next === -1 ? value.length : next
}

/** Tab and Shift+Tab; every line the selection touches moves one level, two spaces */
export function indentLines(value: string, start: number, end: number, outdent: boolean): Edit {
  const first = lineStartOf(value, start)
  const last = lineEndOf(value, end)

  let startShift = 0
  let endShift = 0
  let lineStart = first
  // an outdent can't carry a caret back past the start of its own line
  const shiftFor = (pos: number, delta: number): number => (delta >= 0 ? delta : Math.max(delta, lineStart - pos))

  const lines = value.slice(first, last).split('\n').map(line => {
    const removed = outdent ? (/^ {1,2}/.exec(line)?.[0].length ?? 0) : 0
    const delta = outdent ? -removed : 2
    if (start >= lineStart) startShift += shiftFor(start, delta)
    if (end >= lineStart) endShift += shiftFor(end, delta)
    lineStart += line.length + 1
    return outdent ? line.slice(removed) : `  ${line}`
  })

  return {
    value: value.slice(0, first) + lines.join('\n') + value.slice(last),
    start: start + startShift,
    end: end + endShift
  }
}

const LIST_ITEM = /^(\s*)([-*•]|(\d{1,3})([.)]))(\s+)(.*)$/

/** Enter in a list: the next item at the same depth, or out of the list from an empty one */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const lineStart = lineStartOf(value, caret)
  const lineEnd = lineEndOf(value, caret)
  const line = value.slice(lineStart, lineEnd)

  const m = LIST_ITEM.exec(line)
  if (!m) return null
  const [, indent, marker, digits, closer, , content] = m

  // a caret inside the marker is just a line break
  if (caret - lineStart < line.length - content.length) return null

  if (!content.trim()) {
    return { value: value.slice(0, lineStart) + value.slice(lineEnd), caret: lineStart }
  }

  const next = digits ? `${Number(digits) + 1}${closer}` : marker
  const insert = `\n${indent}${next} `
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + insert.length }
}

/** where Tab means a level: a list item, or a line already indented */
export function takesIndent(value: string, at: number): boolean {
  const line = value.slice(lineStartOf(value, at), lineEndOf(value, at))
  return LIST_ITEM.test(line) || /^[ \t]/.test(line)
}
