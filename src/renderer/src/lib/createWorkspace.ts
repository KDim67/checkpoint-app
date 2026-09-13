/** shared by Settings and first run so both make the same workspace, through ordinary paths */

import { normalizeBoardConfig, saveBoardConfig } from './boardConfig'
import {
  buildTemplateCards,
  buildTemplateColumns,
  describeTemplate,
  findProjectTemplate
} from '../../../shared/projectTemplates'
import { collectLabels, type ImportedBoard } from '../../../shared/foreignImport'
import { readWorkspaceList, writeWorkspaceList } from './workspaceList'
import { createItem } from '../data/items'
import { getContexts } from '../data/workspaces'
import { createTag } from '../data/tags'
import { setSetting } from '../data/settings'

/** same slug rule as the manager */
export function slugifyWorkspace(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** an unknown template leaves a usable empty workspace and returns '' */
async function applyProjectTemplate(slug: string, templateId: string): Promise<string> {
  const template = findProjectTemplate(templateId)
  if (!template) return ''

  await saveBoardConfig(slug, normalizeBoardConfig({
    version: 1,
    columns: buildTemplateColumns(template)
  }))

  for (const draft of buildTemplateCards(template)) {
    await createItem({
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

/** tags created once and reused; cards one at a time so one bad card can't sink the import */
export async function applyImportedBoard(slug: string, board: ImportedBoard): Promise<string> {
  await saveBoardConfig(slug, normalizeBoardConfig({
    version: 1,
    columns: board.columns.map(c => ({ id: c.id, name: c.name, wipLimit: null }))
  }))

  const tagIdByName = new Map<string, string>()
  for (const label of collectLabels(board)) {
    try {
      const tag = await createTag(label.name, label.color)
      tagIdByName.set(label.name, tag.id)
    } catch (err) {
      // a tag failure isn't worth losing the card
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
      await createItem(
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
  /** a label, not a mode: someone else's board shouldn't look like your own */
  shared?: boolean
}

/** shared by onboarding, settings and joining */
export const WORKSPACE_COLORS = [
  '#1e45fc', '#cdf12b', '#10b981', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'
]

/** the picker reads this list; existing entries come back untouched */
export function ensureWorkspaceListed(
  list: WorkspaceEntry[],
  slug: string,
  name?: string
): WorkspaceEntry[] {
  // same array, the caller skips the write on identity
  if (list.some(w => w.slug === slug)) return list

  return [...list, {
    slug,
    name: name?.trim() || slug,
    color: WORKSPACE_COLORS[list.length % WORKSPACE_COLORS.length]
  }]
}

/** items and the list both count; the item read may throw so deletes never get an empty answer */
export async function occupiedWorkspaces(): Promise<Set<string>> {
  const taken = new Set<string>(await getContexts())

  for (const entry of await readWorkspaceList()) taken.add(entry.slug)

  return taken
}

/** keeps both copies, with a name predictable enough to show first */
export function availableWorkspaceSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(desired)) return desired

  const shared = `${desired}-shared`
  if (!used.has(shared)) return shared

  // counts, so a third join doesn't land on the second copy
  for (let n = 2; n < 1000; n++) {
    const candidate = `${shared}-${n}`
    if (!used.has(candidate)) return candidate
  }
  // never return a taken slug, that'd be a wipe
  return `${shared}-${Date.now()}`
}

/** same list when unchanged */
export function setWorkspaceShared(
  list: WorkspaceEntry[],
  slug: string,
  shared: boolean
): WorkspaceEntry[] {
  const entry = list.find(w => w.slug === slug)
  if (!entry || Boolean(entry.shared) === shared) return list
  // absent not false, so unshared workspaces serialise as before
  return list.map(w => {
    if (w.slug !== slug) return w
    if (shared) return { ...w, shared: true }
    const next = { ...w }
    delete next.shared
    return next
  })
}

/** separate since rejoining is exactly when the label is needed */
export function markWorkspaceShared(
  list: WorkspaceEntry[],
  slug: string,
  name?: string
): WorkspaceEntry[] {
  return setWorkspaceShared(ensureWorkspaceListed(list, slug, name), slug, true)
}

/** list only, the baseline brings the board; never throws mid-join */
export async function registerSharedWorkspace(
  slug: string,
  name?: string
): Promise<WorkspaceEntry[]> {
  const existing = await readWorkspaceList()
  const next = markWorkspaceShared(existing, slug, name)
  // already listed and labelled
  if (next === existing) return next

  try {
    await writeWorkspaceList(next)
  } catch (err) {
    console.error('Could not record the shared workspace:', err)
  }
  return next
}

/** list first, a failed scaffold still leaves a usable workspace */
export async function createWorkspace(
  existing: WorkspaceEntry[],
  entry: WorkspaceEntry,
  templateId: string
): Promise<{ list: WorkspaceEntry[]; summary: string; templateFailed: boolean }> {
  const list = [...existing, entry]
  await setSetting('contexts_list', JSON.stringify(list))

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
