/**
 * Creating a workspace from a project template.
 *
 * Two places do this. The context manager in Settings and the first-run
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

/** The same slug rule the context manager has always used. */
export function slugifyWorkspace(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Writes the template's board and seeds its cards for an existing workspace
 * slug. Returns a one-line summary for a toast, or '' when the template id is
 * unknown. An unrecognised template should leave a usable empty workspace
 * rather than fail the whole creation.
 */
export async function applyProjectTemplate(slug: string, templateId: string): Promise<string> {
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
