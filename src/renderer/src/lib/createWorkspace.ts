/**
 * Creating a workspace from a project template.
 *
 * Two places do this, the context manager in Settings and the first-run
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

/** The same slug rule the context manager has always used. */
export function slugifyWorkspace(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Writes the template's board and seeds its cards for an existing workspace
 * slug. Returns a one-line summary for a toast, or '' when the template id is
 * unknown, an unrecognised template should leave a usable empty workspace
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
