/**
 * Creating a workspace from a project template.
 *
 * Two places do this. The workspace manager in Settings and the first-run
 * panel, and they must produce the same thing, so the scaffolding lives here
 * rather than in either of them.
 *
 * Everything goes through the ordinary board-config and item paths, so a
 * templated workspace is an ordinary one the moment it exists: there is no
 * template state left behind to reason about later.
 */

import { normalizeBoardConfig, saveBoardConfig } from './boardConfig'
import {
  buildTemplateCards,
  buildTemplateColumns,
  describeTemplate,
  findProjectTemplate
} from '../../../shared/projectTemplates'
import { collectLabels, type ImportedBoard } from '../../../shared/foreignImport'
import { readWorkspaceList, writeWorkspaceList } from './workspaceList'

/** The same slug rule the workspace manager has always used. */
export function slugifyWorkspace(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Writes the template's board and seeds its cards for an existing workspace
 * slug. Returns a one-line summary for a toast, or '' when the template id is
 * unknown. An unrecognised template should leave a usable empty workspace
 * rather than fail the whole creation.
 */
async function applyProjectTemplate(slug: string, templateId: string): Promise<string> {
  const template = findProjectTemplate(templateId)
  if (!template) return ''

  await saveBoardConfig(slug, normalizeBoardConfig({
    version: 1,
    columns: buildTemplateColumns(template)
  }))

  for (const draft of buildTemplateCards(template)) {
    await window.electronAPI.db.createItem({
      type: 'card',
      context: slug,
      title: draft.title,
      body: draft.body,
      status: draft.status,
      priority: draft.priority,
      position: draft.position,
      due_at: null,
      metadata: draft.metadata
    })
  }

  return `Created "${template.name}" workspace, ${describeTemplate(template)}.`
}

/**
 * Writes an imported board into a workspace that already exists.
 *
 * Tags are created once up front and reused, rather than per card: the same
 * label appears on many cards, and creating it each time would leave duplicate
 * tags with the same name.
 *
 * Cards are created one at a time on purpose. A board of a few hundred is the
 * realistic case, the writes are local, and doing them individually means a
 * single malformed card cannot take the whole import down with it.
 */
export async function applyImportedBoard(slug: string, board: ImportedBoard): Promise<string> {
  await saveBoardConfig(slug, normalizeBoardConfig({
    version: 1,
    columns: board.columns.map(c => ({ id: c.id, name: c.name, wipLimit: null }))
  }))

  const tagIdByName = new Map<string, string>()
  for (const label of collectLabels(board)) {
    try {
      const tag = await window.electronAPI.db.createTag({ name: label.name, color: label.color })
      tagIdByName.set(label.name, tag.id)
    } catch (err) {
      // A tag that cannot be made is not worth losing the card it was on.
      console.warn(`Could not create tag "${label.name}":`, err)
    }
  }

  let created = 0
  let failed = 0
  for (const card of board.cards) {
    try {
      const checklist = card.checklist.map((item, i) => ({
        id: `imp-${created}-${i}`,
        text: item.text,
        done: item.done
      }))
      await window.electronAPI.db.createItem(
        {
          type: 'card',
          context: slug,
          title: card.title,
          body: card.body,
          status: card.status,
          priority: card.priority,
          position: card.position,
          due_at: card.due_at,
          metadata: JSON.stringify({ isTemplate: false, checklist, comments: [], activities: [] })
        },
        card.labels.map(l => tagIdByName.get(l.name)).filter((id): id is string => Boolean(id))
      )
      created++
    } catch (err) {
      failed++
      console.warn(`Could not import card "${card.title}":`, err)
    }
  }

  const parts = [`Imported ${created} card${created === 1 ? '' : 's'} into ${board.columns.length} columns`]
  if (failed > 0) parts.push(`${failed} could not be created`)
  return [...parts, ...board.notes].join('. ') + '.'
}

export interface WorkspaceEntry {
  slug: string
  name: string
  color: string
  gitPath?: string
  /**
   * Has been part of a P2P session, hosted or joined.
   *
   * A label rather than a mode: nothing behaves differently because of it. It
   * exists so a workspace holding someone else's board is not indistinguishable
   * from one of your own, which is the whole of the complaint.
   */
  shared?: boolean
}

/** Shared by onboarding, the settings manager and joining a shared board. */
export const WORKSPACE_COLORS = [
  '#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'
]

/**
 * The picker reads this list, so a workspace missing from it is unreachable
 * once you leave. An existing entry comes back untouched: rejoining a shared
 * board is not a rename.
 */
export function ensureWorkspaceListed(
  list: WorkspaceEntry[],
  slug: string,
  name?: string
): WorkspaceEntry[] {
  // Same array, not a copy: the caller skips the write on identity.
  if (list.some(w => w.slug === slug)) return list

  return [...list, {
    slug,
    name: name?.trim() || slug,
    color: WORKSPACE_COLORS[list.length % WORKSPACE_COLORS.length]
  }]
}

/**
 * Every workspace slug that is spoken for.
 *
 * Both halves matter. A slug can hold items without ever reaching the picker,
 * and a workspace can be listed while still empty. Treating either as free is
 * how joining a shared board overwrites something.
 *
 * The item read is allowed to throw: a caller deciding whether it is safe to
 * delete a board must not be handed an empty set when the question could not
 * be answered. The list read is a second opinion and only logs.
 */
export async function occupiedWorkspaces(): Promise<Set<string>> {
  const taken = new Set<string>(await window.electronAPI.db.getContexts())

  for (const entry of await readWorkspaceList()) taken.add(entry.slug)

  return taken
}

/**
 * A slug near `desired` that nothing is using yet.
 *
 * Joining a shared board used to overwrite whatever was already under that
 * name. Keeping both copies needs somewhere to put the second one, and the
 * name has to be predictable enough to show in the prompt before it is made.
 */
export function availableWorkspaceSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(desired)) return desired

  const shared = `${desired}-shared`
  if (!used.has(shared)) return shared

  // Counts rather than searching, so joining the same board a third time does
  // not land back on the second copy.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${shared}-${n}`
    if (!used.has(candidate)) return candidate
  }
  // A thousand copies of one board is not a real situation, but silently
  // returning a taken slug would be a wipe, so this ends somewhere unique.
  return `${shared}-${Date.now()}`
}

/** Turns the shared label on or off. Returns the same list when it already says that. */
export function setWorkspaceShared(
  list: WorkspaceEntry[],
  slug: string,
  shared: boolean
): WorkspaceEntry[] {
  const entry = list.find(w => w.slug === slug)
  if (!entry || Boolean(entry.shared) === shared) return list
  // Absent rather than false, so an unshared workspace serialises the way it
  // did before the flag existed.
  return list.map(w => {
    if (w.slug !== slug) return w
    if (shared) return { ...w, shared: true }
    const next = { ...w }
    delete next.shared
    return next
  })
}

/**
 * Lists a workspace if it is new and labels it shared either way.
 *
 * Separate from ensureWorkspaceListed because rejoining a board you already
 * hold is exactly the case that needs the label, and exactly the case that
 * function deliberately leaves untouched.
 */
export function markWorkspaceShared(
  list: WorkspaceEntry[],
  slug: string,
  name?: string
): WorkspaceEntry[] {
  return setWorkspaceShared(ensureWorkspaceListed(list, slug, name), slug, true)
}

/**
 * The list only: the baseline brings the board and its columns, so scaffolding
 * here would lay a template over data that has just arrived. Never throws, as
 * this runs mid-join and a failed write should cost a picker entry, not the board.
 */
export async function registerSharedWorkspace(
  slug: string,
  name?: string
): Promise<WorkspaceEntry[]> {
  const existing = await readWorkspaceList()
  const next = markWorkspaceShared(existing, slug, name)
  // Identity: already listed and already labelled, so nothing to write.
  if (next === existing) return next

  try {
    await writeWorkspaceList(next)
  } catch (err) {
    console.error('Could not record the shared workspace:', err)
  }
  return next
}

/**
 * Registers a workspace in the contexts list and scaffolds it.
 *
 * The list write happens first: if the scaffolding fails the workspace still
 * exists and is usable, which is a better outcome than unwinding and leaving
 * the user with nothing.
 */
export async function createWorkspace(
  existing: WorkspaceEntry[],
  entry: WorkspaceEntry,
  templateId: string
): Promise<{ list: WorkspaceEntry[]; summary: string; templateFailed: boolean }> {
  const list = [...existing, entry]
  await window.electronAPI.db.setSetting('contexts_list', JSON.stringify(list))

  let summary = ''
  let templateFailed = false
  try {
    summary = await applyProjectTemplate(entry.slug, templateId)
  } catch (err) {
    console.error('Failed to apply project template:', err)
    templateFailed = true
  }

  return { list, summary, templateFailed }
}
