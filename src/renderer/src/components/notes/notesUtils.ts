// Pure helpers, persisted preferences, templates and markdown editing utilities
// for the Notes feature. Kept framework-free so they are trivially testable and
// reusable across the notes subcomponents.

// Formatting

/** Human-friendly relative time, e.g. "just now", "5m ago", "3d ago", or a date. */
export function formatRelativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const week = Math.floor(day / 7)
  if (week < 5) return `${week}w ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Compact byte formatter, e.g. "812 B", "3.4 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Word count of arbitrary text. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Estimated reading time at ~200 wpm, e.g. "1 min read". */
export function readingTime(text: string): string {
  const words = countWords(text)
  const minutes = Math.max(1, Math.round(words / 200))
  return `${minutes} min read`
}

/** Extracts unaliased [[wiki-link]] targets from raw markdown. */
export function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)
  return Array.from(new Set(Array.from(matches).map(m => m[1].trim())))
}

// Persisted preferences (localStorage)

export type SortKey = 'updated' | 'title' | 'size'
export type ViewMode = 'edit' | 'preview' | 'split'

const PREFIX = 'checkpoint.notes.'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable; ignore */
  }
}

export const prefs = {
  getPins: (): string[] => read<string[]>('pins', []),
  setPins: (pins: string[]): void => write('pins', pins),
  getSort: (): SortKey => read<SortKey>('sort', 'updated'),
  setSort: (sort: SortKey): void => write('sort', sort),
  getMode: (): ViewMode => read<ViewMode>('mode', 'split'),
  setMode: (mode: ViewMode): void => write('mode', mode),
  getShowInfo: (): boolean => read<boolean>('showInfo', true),
  setShowInfo: (v: boolean): void => write('showInfo', v),
  getLastNote: (): string | null => read<string | null>('lastNote', null),
  setLastNote: (t: string | null): void => write('lastNote', t)
}

// Templates

export interface NoteTemplate {
  id: string
  label: string
  description: string
  build: (title: string) => string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local date as YYYY-MM-DD, used for daily-note titles. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    label: 'Blank note',
    description: 'An empty note with just a title.',
    build: title => `# ${title}\n\n`
  },
  {
    id: 'daily',
    label: 'Daily log',
    description: 'Date-stamped sections for a standup-style journal.',
    build: title => `# ${title}\n\n## 🎯 Focus\n\n- \n\n## ✅ Done\n\n- \n\n## 🚧 Blockers\n\n- \n\n## 📝 Notes\n\n`
  },
  {
    id: 'meeting',
    label: 'Meeting notes',
    description: 'Attendees, agenda, decisions and action items.',
    build: title => `# ${title}\n\n**Date:** ${isoDate()}\n**Attendees:** \n\n## Agenda\n\n- \n\n## Discussion\n\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n`
  },
  {
    id: 'spec',
    label: 'Technical spec',
    description: 'Problem, proposal, alternatives and open questions.',
    build: title => `# ${title}\n\n## Problem\n\n\n\n## Proposal\n\n\n\n## Alternatives considered\n\n- \n\n## Open questions\n\n- \n`
  },
  {
    id: 'todo',
    label: 'Checklist',
    description: 'A simple task checklist.',
    build: title => `# ${title}\n\n- [ ] \n- [ ] \n- [ ] \n`
  }
]

/** Content for a fresh daily note. */
export function dailyNoteContent(title: string): string {
  const tmpl = NOTE_TEMPLATES.find(t => t.id === 'daily')!
  return tmpl.build(title)
}

// Markdown editing (selection-aware, pure)

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeblock'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'checkbox'
  | 'link'
  | 'wikilink'
  | 'table'
  | 'mermaid'
  | 'hr'

export interface EditResult {
  value: string
  selStart: number
  selEnd: number
}

const WRAPPERS: Partial<Record<FormatAction, { marker: string; placeholder: string }>> = {
  bold: { marker: '**', placeholder: 'bold text' },
  italic: { marker: '*', placeholder: 'italic text' },
  strike: { marker: '~~', placeholder: 'strikethrough' },
  code: { marker: '`', placeholder: 'code' }
}

const LINE_PREFIXES: Partial<Record<FormatAction, string>> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  quote: '> ',
  ul: '- ',
  ol: '1. ',
  checkbox: '- [ ] '
}

/**
 * Applies a markdown formatting action to a textarea's value given its current
 * selection, returning the new value and where the selection should land.
 */
export function applyFormat(
  action: FormatAction,
  value: string,
  selStart: number,
  selEnd: number
): EditResult {
  const selected = value.slice(selStart, selEnd)

  // Inline wrappers (bold/italic/strike/code)
  const wrap = WRAPPERS[action]
  if (wrap) {
    const { marker, placeholder } = wrap
    const inner = selected || placeholder
    const next = value.slice(0, selStart) + marker + inner + marker + value.slice(selEnd)
    const innerStart = selStart + marker.length
    return { value: next, selStart: innerStart, selEnd: innerStart + inner.length }
  }

  // Line prefixes (headings, lists, quote, checkbox)
  const prefix = LINE_PREFIXES[action]
  if (prefix) {
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1
    const lineEndRaw = value.indexOf('\n', selEnd)
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw
    const block = value.slice(lineStart, lineEnd)
    const updated = block
      .split('\n')
      .map(line => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line))
      .join('\n')
    const next = value.slice(0, lineStart) + updated + value.slice(lineEnd)
    return { value: next, selStart: lineStart, selEnd: lineStart + updated.length }
  }

  // Block/insert actions
  switch (action) {
    case 'link': {
      const text = selected || 'link text'
      const inserted = `[${text}](https://)`
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      // place cursor inside the url parens
      const urlPos = selStart + text.length + 3
      return { value: next, selStart: urlPos, selEnd: urlPos + 8 }
    }
    case 'wikilink': {
      const text = selected || 'Note Title'
      const inserted = `[[${text}]]`
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      const innerStart = selStart + 2
      return { value: next, selStart: innerStart, selEnd: innerStart + text.length }
    }
    case 'codeblock': {
      const body = selected || 'code'
      const inserted = `\n\`\`\`\n${body}\n\`\`\`\n`
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      const bodyStart = selStart + 5
      return { value: next, selStart: bodyStart, selEnd: bodyStart + body.length }
    }
    case 'mermaid': {
      const inserted = '\n```mermaid\ngraph TD\n  A[Start] --> B[Next]\n```\n'
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      const pos = selStart + inserted.length
      return { value: next, selStart: pos, selEnd: pos }
    }
    case 'table': {
      const inserted = '\n| Column A | Column B |\n| --- | --- |\n| Cell | Cell |\n'
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      const pos = selStart + inserted.length
      return { value: next, selStart: pos, selEnd: pos }
    }
    case 'hr': {
      const inserted = '\n---\n'
      const next = value.slice(0, selStart) + inserted + value.slice(selEnd)
      const pos = selStart + inserted.length
      return { value: next, selStart: pos, selEnd: pos }
    }
    default:
      return { value, selStart, selEnd }
  }
}
