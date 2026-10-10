/** wall text stays plain with Notes' markers, so search, export and the assistant read it as written */

import { linkSegments } from './wallLink'
import { WALL_FONTS, type TextAlign, type WallFont, type WallItem } from './wallModel'

export interface TextSpan {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  underline?: boolean
  url?: string
  /** six hex digits, lower case */
  color?: string
  /** a multiple of the box's own size, so a bigger word stays bigger when the box's size changes */
  size?: number
  font?: WallFont
}

type Aligned = { align?: TextAlign }

export type TextBlock =
  | ({ type: 'paragraph'; spans: TextSpan[] } & Aligned)
  | ({ type: 'bullet'; depth: number; spans: TextSpan[] } & Aligned)
  | ({ type: 'number'; depth: number; number: number; spans: TextSpan[] } & Aligned)

/** a line as the editor holds it: list markers stay typed characters, words keep their styles */
export interface WallLine {
  align?: TextAlign
  runs: TextSpan[]
}

type Style = Omit<TextSpan, 'text'>

// code first so its contents stay literal; an underscore needs a non-word edge, snake_case isn't italic
// ++underline++ is the one marker markdown lacks, so it borrows the common extension's
const INLINE = /`([^`\n]+)`|\*\*(?=\S)([\s\S]*?\S)\*\*|~~(?=\S)([\s\S]*?\S)~~|\+\+(?=\S)([\s\S]*?\S)\+\+|\*(?=[^\s*])([^*]*?[^\s*])\*|(?<!\w)_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/
const INLINE_AT = new RegExp(INLINE.source, 'y')

const COLOR = /^#[0-9a-f]{6}$/i
const SIZE = /^\d+(\.\d+)?$/
const MIN_SIZE = 0.25
const MAX_SIZE = 8
const LINK = /^(https?:\/\/|mailto:)[^\s()<>]+$/i
const ALIGN_PREFIX = /^\{align=(left|center|right)\}/

function styled(text: string, style: Style, autoLink: boolean): TextSpan[] {
  if (!text) return []
  // an address in code, or already in a link, is what it is
  if (style.code || style.url || !autoLink) return [{ text, ...style }]
  return linkSegments(text).map(s => (s.url ? { text: s.text, ...style, url: s.url } : { text: s.text, ...style }))
}

const sameStyle = (a: TextSpan, b: TextSpan): boolean =>
  a.url === b.url && !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike &&
  !!a.code === !!b.code && !!a.underline === !!b.underline && a.color === b.color && a.size === b.size && a.font === b.font

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

type SpanAttrs = Pick<TextSpan, 'url' | 'color' | 'size' | 'font'>

function readAttrs(body: string): SpanAttrs | null {
  const out: SpanAttrs = {}
  for (const part of body.trim().split(/\s+/)) {
    const [key, value = ''] = part.split('=')
    if (key === 'color' && COLOR.test(value)) out.color = value.toLowerCase()
    else if (key === 'size' && SIZE.test(value) && Number(value) >= MIN_SIZE && Number(value) <= MAX_SIZE) out.size = Number(value)
    else if (key === 'font' && (WALL_FONTS as readonly string[]).includes(value)) out.font = value as WallFont
  }
  return Object.keys(out).length > 0 ? out : null
}

/** [words](address){attrs}, [words](address) or [words]{attrs} from an opening bracket; null for anything else */
function bracketAt(text: string, at: number): { inner: string; end: number; attrs: SpanAttrs } | null {
  let depth = 0
  let close = -1
  for (let i = at; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']' && --depth === 0) {
      close = i
      break
    }
  }
  if (close <= at + 1) return null
  const attrs: SpanAttrs = {}
  let end = close + 1
  if (text[end] === '(') {
    const shut = text.indexOf(')', end)
    const address = shut === -1 ? '' : text.slice(end + 1, shut)
    if (!LINK.test(address)) return null
    attrs.url = address
    end = shut + 1
  }
  if (text[end] === '{') {
    const shut = text.indexOf('}', end)
    const read = shut === -1 ? null : readAttrs(text.slice(end + 1, shut))
    if (read) {
      Object.assign(attrs, read)
      end = shut + 1
    }
  }
  if (Object.keys(attrs).length === 0) return null
  return { inner: text.slice(at + 1, close), end, attrs }
}

function inline(text: string, style: Style = {}, autoLink = true): TextSpan[] {
  const out: TextSpan[] = []
  let plain = 0
  let i = 0
  const flush = (end: number): void => {
    out.push(...styled(text.slice(plain, end), style, autoLink))
  }
  while (i < text.length) {
    if (text[i] === '[') {
      const span = bracketAt(text, i)
      if (span) {
        flush(i)
        out.push(...inline(span.inner, { ...style, ...span.attrs }, autoLink))
        i = plain = span.end
        continue
      }
    }
    if ('`*~+_'.includes(text[i])) {
      INLINE_AT.lastIndex = i
      const m = INLINE_AT.exec(text)
      if (m) {
        flush(i)
        if (m[1] !== undefined) out.push(...styled(m[1], { ...style, code: true }, autoLink))
        else if (m[2] !== undefined) out.push(...inline(m[2], { ...style, bold: true }, autoLink))
        else if (m[3] !== undefined) out.push(...inline(m[3], { ...style, strike: true }, autoLink))
        else if (m[4] !== undefined) out.push(...inline(m[4], { ...style, underline: true }, autoLink))
        else out.push(...inline(m[5] ?? m[6], { ...style, italic: true }, autoLink))
        i = plain = i + m[0].length
        continue
      }
    }
    i++
  }
  flush(text.length)
  return merge(out)
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const LIST_PREFIX = /^\s*(?:[-*•]|\d{1,3}[.)])\s+/

/** two spaces or a tab a level */
const depthOf = (indent: string): number => Math.floor(indent.replace(/\t/g, '  ').length / 2)

const linesOf = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n')

function splitAlign(line: string): { align?: TextAlign; rest: string } {
  const m = ALIGN_PREFIX.exec(line)
  return m ? { align: m[1] as TextAlign, rest: line.slice(m[0].length) } : { rest: line }
}

export function parseWallText(text: string): TextBlock[] {
  return linesOf(text).map((line): TextBlock => {
    const { align, rest } = splitAlign(line)
    const aligned = align ? { align } : {}
    const bullet = BULLET.exec(rest)
    if (bullet) return { type: 'bullet', depth: depthOf(bullet[1]), spans: inline(bullet[2]), ...aligned }
    const numbered = NUMBERED.exec(rest)
    if (numbered) {
      return { type: 'number', depth: depthOf(numbered[1]), number: Number(numbered[2]), spans: inline(numbered[3]), ...aligned }
    }
    return { type: 'paragraph', spans: inline(rest), ...aligned }
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

/** lines for the editor: a list marker stays the characters typed, and a bare address stays words until drawn */
export function parseWallLines(text: string): WallLine[] {
  return linesOf(text).map(line => {
    const { align, rest } = splitAlign(line)
    const prefix = LIST_PREFIX.exec(rest)?.[0] ?? ''
    const runs = merge([...(prefix ? [{ text: prefix }] : []), ...inline(rest.slice(prefix.length), {}, false)])
    return align ? { align, runs } : { runs }
  })
}

type MarkerKind = 'bold' | 'italic' | 'strike' | 'underline' | 'code'
// outermost first, the order Ctrl+B and friends nest them in
const MARKER_ORDER: MarkerKind[] = ['bold', 'italic', 'strike', 'underline', 'code']
const MARKER_TEXT: Record<Exclude<MarkerKind, 'italic'>, string> = { bold: '**', strike: '~~', underline: '++', code: '`' }

const isWord = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch)

interface Emission {
  lead: string
  kinds: MarkerKind[]
  core: string
  trail: string
}

/** each run's markers hug its words; spaces sit outside them, where markdown wants them */
function emit(run: TextSpan): Emission {
  const lead = /^\s*/.exec(run.text)?.[0] ?? ''
  const core = run.text.slice(lead.length).trimEnd()
  const trail = run.text.slice(lead.length + core.length)
  if (!core) return { lead: run.text, kinds: [], core: '', trail: '' }
  // code keeps its contents literal, so a backtick inside can't be code
  const kinds = MARKER_ORDER.filter(k => run[k] && (k !== 'code' || !core.includes('`')))
  return { lead, kinds, core, trail }
}

function markersFor(runs: TextSpan[]): string {
  const emissions = merge(runs).map(emit)
  let out = ''
  emissions.forEach((e, i) => {
    const next = emissions[i + 1]
    const before = e.lead ? e.lead[e.lead.length - 1] : out[out.length - 1]
    const after = e.trail ? e.trail[0] : next ? (next.lead || (next.kinds.length > 0 ? '*' : next.core))[0] : undefined
    // an underscore beside a letter, or around words holding one, isn't italic; an asterisk is
    const outerItalic = e.kinds[0] === 'italic'
    const italic = e.core.includes('_') || (outerItalic && (isWord(before) || isWord(after))) ? '*' : '_'
    const marker = (k: MarkerKind): string => (k === 'italic' ? italic : MARKER_TEXT[k])
    const open = e.kinds.map(marker).join('')
    const close = [...e.kinds].reverse().map(marker).join('')
    out += `${e.lead}${open}${e.core}${close}${e.trail}`
  })
  return out
}

const attrsOf = (run: TextSpan): SpanAttrs => ({
  ...(run.url ? { url: run.url } : {}),
  ...(run.color ? { color: run.color } : {}),
  ...(run.size !== undefined ? { size: run.size } : {}),
  ...(run.font ? { font: run.font } : {})
})

const sameAttrs = (a: SpanAttrs, b: SpanAttrs): boolean => a.url === b.url && a.color === b.color && a.size === b.size && a.font === b.font

function serializeRuns(runs: TextSpan[]): string {
  const groups: { attrs: SpanAttrs; runs: TextSpan[] }[] = []
  for (const run of runs) {
    if (!run.text) continue
    const attrs = attrsOf(run)
    const last = groups[groups.length - 1]
    if (last && sameAttrs(last.attrs, attrs)) last.runs.push(run)
    else groups.push({ attrs, runs: [run] })
  }
  return groups.map(({ attrs, runs: inGroup }) => {
    const plain = inGroup.map(r => ({ text: r.text, bold: r.bold, italic: r.italic, strike: r.strike, underline: r.underline, code: r.code }))
    const body = markersFor(plain)
    if (Object.keys(attrs).length === 0) return body
    const named = [
      attrs.color ? `color=${attrs.color}` : '',
      attrs.size !== undefined ? `size=${Number(attrs.size.toFixed(2))}` : '',
      attrs.font ? `font=${attrs.font}` : ''
    ].filter(Boolean).join(' ')
    return `[${body}]${attrs.url ? `(${attrs.url})` : ''}${named ? `{${named}}` : ''}`
  }).join('')
}

/** the editor's lines as stored text */
export function serializeWallLines(lines: WallLine[]): string {
  return lines.map(line => `${line.align ? `{align=${line.align}}` : ''}${serializeRuns(line.runs)}`).join('\n')
}

/** one style off every word, for when the whole box takes it; text without it comes back as it was */
export function stripWordStyle(text: string, key: 'color' | 'font'): string {
  const lines = parseWallLines(text)
  if (!lines.some(line => line.runs.some(run => run[key] !== undefined))) return text
  return serializeWallLines(lines.map(line => ({
    ...line,
    runs: line.runs.map(run => {
      const next = { ...run }
      delete next[key]
      return next
    })
  })))
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

/** Enter in one line, for an editor that holds lines apart: the marker the next item starts with, leave the list from an empty item, or null for a plain new line */
export function listContinuation(line: string, caret: number): { prefix: string } | 'leave' | null {
  const m = LIST_ITEM.exec(line)
  if (!m) return null
  const [, indent, marker, digits, closer, , content] = m
  // a caret inside the marker is just a line break
  if (caret < line.length - content.length) return null
  if (!content.trim()) return 'leave'
  return { prefix: `${indent}${digits ? `${Number(digits) + 1}${closer}` : marker} ` }
}

/** where Tab means a level: a list item, or a line already indented */
export function takesIndent(value: string, at: number): boolean {
  const line = value.slice(lineStartOf(value, at), lineEndOf(value, at))
  return LIST_ITEM.test(line) || /^[ \t]/.test(line)
}

/**
 * a change to whole boxes; a colour or font for the whole box takes over from the one single words wear,
 * except a sticky's or a shape's colour, which is its paper and not its letters
 */
export function restyleBoxes(items: WallItem[], ids: Set<string>, patch: Partial<WallItem>, clearWords?: 'color' | 'font'): WallItem[] {
  return items.map(item => {
    if (!ids.has(item.id) || item.locked) return item
    const next = { ...item, ...patch }
    const clears = clearWords === 'font' || (clearWords === 'color' && item.kind === 'text')
    if (clears && item.text) next.text = stripWordStyle(item.text, clearWords)
    return next
  })
}
