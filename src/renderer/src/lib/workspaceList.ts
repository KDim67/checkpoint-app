/**
 * The list of workspaces, as the settings table holds it.
 *
 * One place because six files read this row and each parsed it its own way:
 * the key was a literal in five of them, the JSON guard was written five times,
 * and a corrupt row failed differently depending on which screen found it.
 */

import type { WorkspaceEntry } from './createWorkspace'

const LIST_KEY = 'contexts_list'

/**
 * Never throws and never returns a non-array. A hand-edited settings row is a
 * real possibility, and a screen that cannot list workspaces is worse than one
 * that lists none.
 */
export async function readWorkspaceList(): Promise<WorkspaceEntry[]> {
  try {
    const raw = await window.electronAPI.db.getSetting(LIST_KEY)
    if (typeof raw !== 'string' || raw === '') return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(entry => entry && typeof entry.slug === 'string') as WorkspaceEntry[]
  } catch (err) {
    console.error('Could not read the workspace list:', err)
    return []
  }
}

export async function writeWorkspaceList(list: WorkspaceEntry[]): Promise<void> {
  await window.electronAPI.db.setSetting(LIST_KEY, JSON.stringify(list))
}
