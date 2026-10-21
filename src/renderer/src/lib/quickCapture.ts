/** what the quick capture bar makes of a line: the kind, the workspace, tags, priority and a due date, and what to suggest while @ or # is being typed */

import { parseNaturalDate } from '../../../shared/naturalDate'

export type CaptureKind = 'log' | 'task'
export type Priority = 0 | 1 | 2 | 3

export interface Capture {
  kind: CaptureKind
  /** what's left once the markers are read */
  title: string
  /** as typed after @, or null for the workspace you're in */
  workspace: string | null
  priority: Priority
  tags: string[]
  /** epoch ms, or null */
  dueAt: number | null
  /** the words the date was read from */
  dueSource: string | null
}

/** "- " or "[ ] " at the start still makes a task, for hands used to writing lists */
const TASK_PREFIX = /^\s*(?:- |\[ \] )/
const PRIORITY = /!(high|med|medium|low|none|3|2|1|0)\b/i
const WORKSPACE = /@([a-zA-Z0-9_-]+)\b/
const TAG = /#([a-zA-Z0-9_-]+)\b/g

export const PRIORITY_NAMES = ['None', 'Low', 'Med', 'High'] as const

export const hasTaskPrefix = (text: string): boolean => TASK_PREFIX.test(text)
export const withoutTaskPrefix = (text: string): string => text.replace(TASK_PREFIX, '')

function priorityOf(word: string): Priority {
  const value = word.toLowerCase()
  if (value === 'high' || value === '3') return 3
  if (value === 'med' || value === 'medium' || value === '2') return 2
  if (value === 'low' || value === '1') return 1
  return 0
}

export function parseCapture(input: string, mode: CaptureKind): Capture {
  const kind: CaptureKind = hasTaskPrefix(input) ? 'task' : mode
  let text = withoutTaskPrefix(input).trim()

  let priority: Priority = 0
  const priorityMatch = text.match(PRIORITY)
  if (priorityMatch) {
    priority = priorityOf(priorityMatch[1])
    text = text.replace(PRIORITY, '')
  }

  const workspaceMatch = text.match(WORKSPACE)
  const workspace = workspaceMatch ? workspaceMatch[1] : null
  if (workspaceMatch) text = text.replace(WORKSPACE, '')

  const tags = Array.from(text.matchAll(TAG), match => match[1])
  text = text.replace(TAG, '')

  // the date last, so #tuesday stays a tag rather than a weekday
  const dated = parseNaturalDate(text.replace(/\s+/g, ' ').trim())
  return { kind, title: dated.cleanedText, workspace, priority, tags, dueAt: dated.dueAt, dueSource: dated.matched }
}

export interface Typing {
  marker: '@' | '#'
  /** typed so far after the marker */
  query: string
  /** where the marker starts and the caret sits, for swapping in a pick */
  start: number
  end: number
}

/** the @workspace or #tag being typed at the caret, if one is */
export function typingAt(text: string, caret: number): Typing | null {
  const match = /(^|\s)([@#])([a-zA-Z0-9_-]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  const start = caret - match[2].length - match[3].length
  return { marker: match[2] as '@' | '#', query: match[3], start, end: caret }
}

/** names starting with what's typed come first, then names holding it anywhere */
export function matching<T>(items: readonly T[], query: string, namesOf: (item: T) => string[], limit = 6): T[] {
  const typed = query.toLowerCase()
  const starts: T[] = []
  const holds: T[] = []
  for (const item of items) {
    const names = namesOf(item).map(name => name.toLowerCase())
    if (names.some(name => name.startsWith(typed))) starts.push(item)
    else if (names.some(name => name.includes(typed))) holds.push(item)
  }
  return [...starts, ...holds].slice(0, limit)
}

/** the workspace an @ means, whatever its case; @Work and @work are the same one */
export function workspaceNamed<T extends { slug: string; name: string }>(list: readonly T[], typed: string): T | null {
  const wanted = typed.toLowerCase()
  return list.find(entry => entry.slug.toLowerCase() === wanted || entry.name.toLowerCase() === wanted) ?? null
}

/** the line with a pick in place of what was typed, and where the caret goes after it */
export function withPick(text: string, typing: Typing, value: string): { text: string; caret: number } {
  const after = text.slice(typing.end).replace(/^[a-zA-Z0-9_-]*/, '')
  const inserted = `${typing.marker}${value} `
  const rest = after.startsWith(' ') ? after.slice(1) : after
  return { text: text.slice(0, typing.start) + inserted + rest, caret: typing.start + inserted.length }
}
