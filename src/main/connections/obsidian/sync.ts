/** one look at the followed folders: notes changed since the last look are read, new tasks get a block id, and the engine settles them with their cards */

import type Database from 'better-sqlite3'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, relative, sep } from 'path'
import { getSetting, setSetting } from '../../db'
import { allDay, dueDay } from '../../../shared/dueDate'
import { joinLines, parseTasks, rewriteTask, splitLines, type TaskChange, type VaultTask } from '../../../shared/obsidianTasks'
import { settleBatch, type Adapter, type FieldPatch, type RemoteItem, type SyncReport } from '../engine'
import { fail, type Failure, type Result } from '../result'
import { isInside, listNotes, readNote, vaultOf, writeNote, type NoteFile } from './vault'

// what this computer last saw in each note, and where each task lives; never synced
export const OBSIDIAN_SYNC_STATE_KEY = 'obsidian_sync_state'

const REPEATS_LOCK = 'This task repeats in Obsidian, so change its date there.'
const REPEATS_DONE = 'This task repeats; tick it in Obsidian so the Tasks plugin makes the next one.'
const CHANGED_MEANWHILE = 'The note changed while Checkpoint was writing to it; trying again on the next check.'

interface ObsidianState {
  files: Record<string, { mtime: number; size: number }>
  /** each task with a card: the note it was last seen in */
  tasks: Record<string, string>
}

export interface ObsidianSyncDeps {
  db: Database.Database
  /** folder to workspace */
  follows: Map<string, string>
  /** folders Checkpoint turned out unable to write to */
  readOnly: Set<string>
  now: () => number
  /** a fresh block id; replaceable so tests know what was written */
  newId?: () => string
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function readState(): ObsidianState {
  const s = rec(getSetting<unknown>(OBSIDIAN_SYNC_STATE_KEY, {}))
  const files: ObsidianState['files'] = {}
  for (const [path, value] of Object.entries(rec(s.files))) {
    const v = rec(value)
    if (typeof v.mtime === 'number' && typeof v.size === 'number') files[path] = { mtime: v.mtime, size: v.size }
  }
  const tasks = Object.fromEntries(Object.entries(rec(s.tasks)).filter((e): e is [string, string] => typeof e[1] === 'string'))
  return { files, tasks }
}

/** eight letters and digits after cp-: unlikely to meet another id anywhere in a vault */
export const blockIdNow = (): string => `cp-${randomBytes(6).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(8, '0').slice(0, 8)}`

const pad = (n: number): string => String(n).padStart(2, '0')

function dayOf(due: number | null): string | null {
  if (due === null) return null
  const d = dueDay(due)
  return `${d.year}-${pad(d.month + 1)}-${pad(d.day)}`
}

function dueFrom(day: string | null): number | null {
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  return allDay({ year, month: month - 1, day: date })
}

/** Checkpoint's own ids are unique across a vault, so a task keeps its card when it moves between notes; anyone else's are only unique in their note */
const remoteIdOf = (blockId: string, root: string, file: string): string =>
  blockId.startsWith('cp-') ? `^${blockId}` : `${relative(root, file).split(sep).join('/')}#^${blockId}`

/** a line with this id in place of any it had */
const withId = (line: string, id: string): string => rewriteTask(line.replace(/\s\^[A-Za-z0-9-]+\s*$/, ''), { blockId: id })

const blockIdIn = (remoteId: string): string => (remoteId.startsWith('^') ? remoteId.slice(1) : remoteId.slice(remoteId.lastIndexOf('#^') + 2))

const failureOf = (err: unknown): Failure => {
  const code = (err as { code?: string }).code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return { ok: false, kind: 'forbidden', message: 'Checkpoint can\'t write to that note.' }
  if (code === 'ENOENT') return { ok: false, kind: 'not-found', message: 'That note isn\'t there any more.' }
  return { ok: false, kind: 'bad', message: err instanceof Error ? err.message : String(err) }
}

export async function syncObsidian(deps: ObsidianSyncDeps): Promise<SyncReport> {
  const report: SyncReport = { changed: 0, problems: [] }
  const state = readState()
  const newId = deps.newId ?? blockIdNow
  // a note belongs to the most specific folder followed
  const roots = [...deps.follows.keys()].sort((a, b) => b.length - a.length)
  const ownerOf = (path: string): string | undefined => roots.find(root => isInside(root, path))
  const vaults = new Map<string, { root: string; name: string }>()
  const vaultFor = (root: string): { root: string; name: string } => {
    const known = vaults.get(root)
    if (known) return known
    const found = vaultOf(root)
    vaults.set(root, found)
    return found
  }

  const toRemote = (task: VaultTask, file: string, root: string, mtime: number): RemoteItem => {
    const vault = vaultFor(root)
    const inVault = relative(vault.root, file).split(sep).join('/').replace(/\.md$/i, '')
    return {
      remoteId: remoteIdOf(task.blockId ?? '', root, file),
      source: root,
      workspace: deps.follows.get(root) ?? null,
      state: task.done ? 'closed' : 'open',
      title: task.title || 'Untitled task',
      body: '',
      due: dueFrom(task.due),
      dueMode: task.recurring ? 'remote' : 'both',
      dueLocked: task.recurring ? REPEATS_LOCK : null,
      labels: [],
      url: `obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(inVault)}`,
      place: basename(file).replace(/\.md$/i, ''),
      updatedAt: mtime,
      priority: task.priority
    }
  }

  // every note under the followed folders, with what changed since the last look
  const listed = new Map<string, NoteFile>()
  for (const root of deps.follows.keys()) {
    if (!existsSync(root)) {
      report.problems.push({ where: deps.follows.get(root) ?? null, kind: 'not-found', message: `The folder ${root} can't be found.` })
      continue
    }
    for (const note of await listNotes(root)) if (!listed.has(note.path)) listed.set(note.path, note)
  }
  const changed = [...listed.values()].filter(n => state.files[n.path]?.mtime !== n.mtime || state.files[n.path]?.size !== n.size)
  const changedPaths = new Set(changed.map(n => n.path))
  // a note no longer listed is either deleted, whose tasks are gone, or in a folder no longer followed, which is just forgotten
  const deleted = new Set<string>()
  for (const path of Object.keys(state.files)) {
    if (listed.has(path)) continue
    if (!existsSync(path) && ownerOf(path)) deleted.add(path)
    delete state.files[path]
  }
  const before = Object.entries(state.tasks).filter(([, file]) => changedPaths.has(file) || deleted.has(file)).map(([id]) => id)
  for (const [id, file] of Object.entries(state.tasks)) {
    if (!listed.has(file) && !deleted.has(file)) delete state.tasks[id]
  }

  const items: RemoteItem[] = []
  const seen = new Set<string>()
  for (const note of changed) {
    const root = ownerOf(note.path)
    if (!root) continue
    let text: string
    try {
      text = await readNote(note.path)
    } catch (err) {
      report.problems.push({ where: basename(note.path), ...failureOf(err) })
      continue
    }
    const lines = splitLines(text)
    let tasks = parseTasks(text)
    // an open task without an id gets one; so does a copy of a line whose id is already taken
    const fresh = tasks.filter(t => {
      if (!t.blockId) return !t.done
      const id = remoteIdOf(t.blockId, root, note.path)
      const elsewhere = state.tasks[id]
      return seen.has(id) || (elsewhere !== undefined && elsewhere !== note.path && listed.has(elsewhere) && !changedPaths.has(elsewhere))
    })
    let mtime = note.mtime
    if (fresh.length > 0) {
      for (const t of fresh) lines.lines[t.line] = withId(lines.lines[t.line], newId())
      try {
        if (await writeNote(root, note.path, joinLines(lines), note.mtime) === 'changed') continue
        mtime = (await stat(note.path)).mtimeMs
      } catch (err) {
        report.problems.push({ where: basename(note.path), ...failureOf(err) })
        continue
      }
      tasks = parseTasks(joinLines(lines))
    }
    state.files[note.path] = { mtime, size: (await stat(note.path)).size }
    for (const task of tasks) {
      if (!task.blockId) continue
      const id = remoteIdOf(task.blockId, root, note.path)
      if (seen.has(id)) continue
      seen.add(id)
      state.tasks[id] = note.path
      items.push(toRemote(task, note.path, root, mtime))
    }
  }
  const gone = before.filter(id => !seen.has(id))
  for (const id of gone) delete state.tasks[id]

  /** one task's line rewritten, read again just before and written only if the note is as read */
  const edit = async (id: string, change: (task: VaultTask) => TaskChange | Failure): Promise<Result<RemoteItem>> => {
    const file = state.tasks[id]
    const root = file ? ownerOf(file) : undefined
    if (!file || !root) return fail('not-found', 'That task isn\'t in a followed folder any more.')
    try {
      const readAt = (await stat(file)).mtimeMs
      const note = splitLines(await readNote(file))
      const task = parseTasks(joinLines(note)).find(t => t.blockId === blockIdIn(id))
      if (!task) return fail('not-found', 'That task isn\'t in its note any more.')
      const wanted = change(task)
      if ('ok' in wanted) return wanted
      note.lines[task.line] = rewriteTask(note.lines[task.line], wanted)
      if (await writeNote(root, file, joinLines(note), readAt) === 'changed') return fail('network', CHANGED_MEANWHILE)
      const after = await stat(file)
      state.files[file] = { mtime: after.mtimeMs, size: after.size }
      const updated = parseTasks(joinLines(note)).find(t => t.blockId === blockIdIn(id)) as VaultTask
      return { ok: true, value: toRemote(updated, file, root, after.mtimeMs) }
    } catch (err) {
      return failureOf(err)
    }
  }

  const adapter: Adapter = {
    service: 'obsidian',
    fieldModes: { title: 'both', body: 'none' },
    sendsDue: true,
    setState: (id, wanted) => edit(id, task => (task.recurring ? { ok: false, kind: 'refused', message: REPEATS_DONE } : { done: wanted === 'closed' })),
    setFields: (id, patch: FieldPatch) => edit(id, () => ({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.due !== undefined ? { due: dayOf(patch.due) } : {})
    })),
    sourceOf: id => (state.tasks[id] ? ownerOf(state.tasks[id]) ?? null : null),
    readOnlyNote: (_root, kept) => `Checkpoint can't write to this folder, so the note kept it ${kept === 'closed' ? 'done' : 'open'}.`
  }

  await settleBatch(
    { db: deps.db, adapter, readOnly: deps.readOnly, now: deps.now },
    { items, covers: id => state.tasks[id] !== undefined && ownerOf(state.tasks[id]) !== undefined, gone },
    report
  )
  setSetting(OBSIDIAN_SYNC_STATE_KEY, state)
  return report
}
