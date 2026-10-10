/** task lines in Obsidian notes: read the way the Tasks plugin and Dataview write them, and rewritten one line at a time so the rest of a note is never touched */

export interface VaultTask {
  /** 0-based line in the note */
  line: number
  title: string
  done: boolean
  /** YYYY-MM-DD */
  due: string | null
  /** how the line keeps its date, so a new one is written the same way */
  dueStyle: 'emoji' | 'dataview' | null
  /** the repeat rule's words, for a repeating task */
  recurring: string | null
  priority: 0 | 1 | 2 | 3
  blockId: string | null
}

export interface TaskChange {
  done?: boolean
  title?: string
  /** null clears it */
  due?: string | null
  /** added only to a line without one */
  blockId?: string
}

export interface NoteLines {
  lines: string[]
  eol: '\n' | '\r\n'
  bom: boolean
}

// the list marker, the box with one character in it, then the text
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/u
// the Tasks plugin's fields start at the first of its signifiers
const SIGNIFIER = /(?:📅|⏳|🛫|➕|✅|❌|🔁|🆔|⛔|🏁|⏫|🔼|🔽|🔺|⏬)️?/u
const BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/
const DATAVIEW = /\[([A-Za-z][\w -]*)::\s*([^\]]*)\]/gu
const DAY = /^\d{4}-\d{2}-\d{2}$/

const DONE_MARKS = new Set(['x', 'X', '-'])

interface Body {
  description: string
  fields: string
  blockId: string | null
}

function splitBody(body: string): Body {
  const id = BLOCK_ID.exec(body)
  const rest = id ? body.slice(0, id.index) : body
  const at = rest.search(SIGNIFIER)
  return {
    description: (at === -1 ? rest : rest.slice(0, at)).trimEnd(),
    fields: at === -1 ? '' : rest.slice(at).trim(),
    blockId: id ? id[1] : null
  }
}

const dataviewFields = (text: string): { key: string; value: string; raw: string }[] =>
  [...text.matchAll(DATAVIEW)].map(m => ({ key: m[1].trim().toLowerCase(), value: m[2].trim(), raw: m[0] }))

const squash = (text: string): string => text.replace(/\s{2,}/g, ' ').trim()

function priorityOf(fields: string): 0 | 1 | 2 | 3 {
  if (/🔺|⏫/u.test(fields)) return 3
  if (/🔼/u.test(fields)) return 2
  if (/🔽|⏬/u.test(fields)) return 1
  return 0
}

function readTask(line: string, index: number): VaultTask | null {
  const m = TASK.exec(line)
  if (!m) return null
  const { description, fields, blockId } = splitBody(m[4])
  const inline = dataviewFields(`${description} ${fields}`)
  const emojiDue = /📅️?\s*(\d{4}-\d{2}-\d{2})/u.exec(fields)
  const dataviewDue = inline.find(f => f.key === 'due' && DAY.test(f.value))
  const recurring = /🔁️?\s*([^📅⏳🛫➕✅❌🆔⛔🏁⏫🔼🔽🔺⏬]+)/u.exec(fields)
  return {
    line: index,
    title: squash(description.replace(DATAVIEW, '')),
    done: DONE_MARKS.has(m[2]),
    due: emojiDue ? emojiDue[1] : dataviewDue ? dataviewDue.value : null,
    dueStyle: emojiDue ? 'emoji' : dataviewDue ? 'dataview' : null,
    recurring: recurring ? recurring[1].trim() || null : null,
    priority: priorityOf(fields),
    blockId
  }
}

/** every task in a note, outside front matter and code */
export function parseTasks(text: string): VaultTask[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const tasks: VaultTask[] = []
  let fence: string | null = null
  let start = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (end > 0) start = end + 1
  }
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    const opener = /^(```|~~~)/.exec(trimmed)
    if (opener) {
      if (fence === null) fence = opener[1]
      else if (trimmed.startsWith(fence)) fence = null
      continue
    }
    if (fence !== null) continue
    const task = readTask(lines[i], i)
    if (task) tasks.push(task)
  }
  return tasks
}

/** the same line with only what changed rewritten */
export function rewriteTask(line: string, change: TaskChange): string {
  const m = TASK.exec(line)
  if (!m) return line
  const [, before, mark, after, body] = m
  const parts = splitBody(body)
  let { description, fields } = parts

  const nextMark = change.done === undefined ? mark : change.done ? (DONE_MARKS.has(mark) && mark !== '-' ? mark : 'x') : ' '

  if (change.title !== undefined) {
    // a Dataview field written into the text stays with it
    const kept = dataviewFields(description).map(f => f.raw)
    description = [change.title.trim(), ...kept].filter(Boolean).join(' ')
  }

  if (change.due !== undefined) {
    const dvDue = /\[due::\s*[^\]]*\]/iu
    if (dvDue.test(description) || dvDue.test(fields)) {
      const replace = (text: string): string => squash(change.due === null ? text.replace(dvDue, '') : text.replace(dvDue, `[due:: ${change.due}]`))
      description = replace(description)
      fields = replace(fields)
    } else if (/📅/u.test(fields)) {
      fields = squash(change.due === null
        ? fields.replace(/📅️?\s*\d{4}-\d{2}-\d{2}/u, '')
        : fields.replace(/(📅️?\s*)\d{4}-\d{2}-\d{2}/u, `$1${change.due}`))
    } else if (change.due !== null) {
      fields = [fields, `📅 ${change.due}`].filter(Boolean).join(' ')
    }
  }

  const blockId = parts.blockId ?? change.blockId ?? null
  const text = [description, fields].filter(Boolean).join(' ')
  return `${before}${nextMark}${after}${text}${blockId ? ` ^${blockId}` : ''}`
}

/** a note split into lines, remembering how it ends and whether it starts with a byte-order mark */
export function splitLines(text: string): NoteLines {
  const bom = text.startsWith('﻿')
  const body = bom ? text.slice(1) : text
  return { lines: body.split(/\r?\n/), eol: body.includes('\r\n') ? '\r\n' : '\n', bom }
}

export function joinLines(note: NoteLines): string {
  return `${note.bom ? '﻿' : ''}${note.lines.join(note.eol)}`
}
