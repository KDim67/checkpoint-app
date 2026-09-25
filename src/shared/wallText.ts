/** wall text stays plain with Notes' markers, so search, export and the assistant read it as written */

import { linkSegments } from './wallLink'

export interface TextSpan {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  underline?: boolean
  url?: string
}

export type TextBlock =
  | { type: 'paragraph'; spans: TextSpan[] }
  | { type: 'bullet'; depth: number; spans: TextSpan[] }
  | { type: 'number'; depth: number; number: number; spans: TextSpan[] }

type Style = Omit<TextSpan, 'text' | 'url'>

// code first so its contents stay literal; an underscore needs a non-word edge, snake_case isn't italic
// ++underline++ is the one marker markdown lacks, so it borrows the common extension's
const INLINE = /`([^`\n]+)`|\*\*(?=\S)([\s\S]*?\S)\*\*|~~(?=\S)([\s\S]*?\S)~~|\+\+(?=\S)([\s\S]*?\S)\+\+|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g

function styled(text: string, style: Style): TextSpan[] {
  if (!text) return []
  // an address in code is code, not a link
  if (style.code) return [{ text, ...style }]
  return linkSegments(text).map(s => (s.url ? { text: s.text, ...style, url: s.url } : { text: s.text, ...style }))
}

const sameStyle = (a: TextSpan, b: TextSpan): boolean =>
  !a.url && !b.url && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike &&
  !!a.code === !!b.code && !!a.underline === !!b.underline

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
    else if (m[4] !== undefined) out.push(...inline(m[4], { ...style, underline: true }))
    else out.push(...inline(m[5] ?? m[6], { ...style, italic: true }))
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

export type WallTextStyleKind = 'bold' | 'italic' | 'strike' | 'underline' | 'code'

export const WALL_STYLE_MARKERS: Record<WallTextStyleKind, string> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  underline: '++',
  code: '`'
}

export const MARKER_TO_STYLE: Record<string, WallTextStyleKind> = {
  '**': 'bold',
  '~~': 'strike',
  '++': 'underline',
  '`': 'code',
  '_': 'italic'
}

const KNOWN_MARKERS: { kind: WallTextStyleKind; marker: string }[] = [
  { kind: 'bold', marker: '**' },
  { kind: 'strike', marker: '~~' },
  { kind: 'underline', marker: '++' },
  { kind: 'code', marker: '`' },
  { kind: 'italic', marker: '_' }
]

const CANONICAL_ORDER: WallTextStyleKind[] = ['bold', 'italic', 'strike', 'underline', 'code']

export function getStylesAtRange(value: string, start: number, end: number): Set<WallTextStyleKind> {
  const styles = new Set<WallTextStyleKind>()
  if (start === end) return styles
  const [s, e] = start < end ? [start, end] : [end, start]

  let left = s
  let right = e
  while (left < right && /\s/.test(value[left])) left++
  while (right > left && /\s/.test(value[right - 1])) right--
  if (left >= right) return styles

  let expanded = true
  while (expanded) {
    expanded = false
    for (const { kind, marker: m } of KNOWN_MARKERS) {
      const n = m.length
      if (left >= n && right + n <= value.length) {
        if (value.slice(left - n, left) === m && value.slice(right, right + n) === m) {
          styles.add(kind)
          left -= n
          right += n
          expanded = true
          break
        }
      }
    }
  }

  let innerLeft = left
  let innerRight = right
  let peeled = true
  while (peeled && innerLeft < innerRight) {
    peeled = false
    const span = value.slice(innerLeft, innerRight)
    for (const { kind, marker: m } of KNOWN_MARKERS) {
      const n = m.length
      if (span.length >= n * 2 && span.startsWith(m) && span.endsWith(m)) {
        styles.add(kind)
        innerLeft += n
        innerRight -= n
        peeled = true
        break
      }
    }
  }

  return styles
}

export function hasWrap(value: string, start: number, end: number, marker: string): boolean {
  const kind = MARKER_TO_STYLE[marker]
  if (!kind) return false
  return getStylesAtRange(value, start, end).has(kind)
}

/** Ctrl+B and friends; toggles markdown formatting cleanly without duplicating or corrupting nested markers */
export function toggleWrap(value: string, start: number, end: number, marker: string): Edit {
  if (start === end) {
    return {
      value: value.slice(0, start) + marker + marker + value.slice(start),
      start: start + marker.length,
      end: start + marker.length
    }
  }

  const [s, e] = start < end ? [start, end] : [end, start]
  const targetKind = MARKER_TO_STYLE[marker]

  const selected = value.slice(s, e)
  const leading = /^\s*/.exec(selected)?.[0] ?? ''
  const trailing = /\s*$/.exec(selected)?.[0] ?? ''
  if (selected.length - leading.length - trailing.length <= 0) {
    return { value, start, end }
  }

  let left = s + leading.length
  let right = e - trailing.length
  const appliedStyles = new Set<WallTextStyleKind>()

  let expanded = true
  while (expanded) {
    expanded = false
    for (const { kind, marker: m } of KNOWN_MARKERS) {
      const n = m.length
      if (left >= n && right + n <= value.length) {
        if (value.slice(left - n, left) === m && value.slice(right, right + n) === m) {
          appliedStyles.add(kind)
          left -= n
          right += n
          expanded = true
          break
        }
      }
    }
  }

  let innerLeft = left
  let innerRight = right
  let peeled = true
  while (peeled && innerLeft < innerRight) {
    peeled = false
    const span = value.slice(innerLeft, innerRight)
    for (const { kind, marker: m } of KNOWN_MARKERS) {
      const n = m.length
      if (span.length >= n * 2 && span.startsWith(m) && span.endsWith(m)) {
        appliedStyles.add(kind)
        innerLeft += n
        innerRight -= n
        peeled = true
        break
      }
    }
  }

  let coreText = value.slice(innerLeft, innerRight)

  if (targetKind) {
    while (coreText.startsWith(marker) && coreText.endsWith(marker) && coreText.length >= marker.length * 2) {
      coreText = coreText.slice(marker.length, coreText.length - marker.length)
    }
  }

  if (targetKind) {
    if (appliedStyles.has(targetKind)) {
      appliedStyles.delete(targetKind)
    } else {
      appliedStyles.add(targetKind)
    }
  }

  let formatted = coreText
  let prefixLen = 0
  for (let i = CANONICAL_ORDER.length - 1; i >= 0; i--) {
    const k = CANONICAL_ORDER[i]
    if (appliedStyles.has(k)) {
      const m = WALL_STYLE_MARKERS[k]
      formatted = m + formatted + m
      prefixLen += m.length
    }
  }

  const resultValue = value.slice(0, left) + formatted + value.slice(right)
  const nextStart = left + prefixLen
  const nextEnd = nextStart + coreText.length

  return {
    value: resultValue,
    start: nextStart,
    end: nextEnd
  }
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
