/** six files parsed this row six ways */

import type { WorkspaceEntry } from './createWorkspace'
import { getSetting, setSetting } from '../data/settings'

const LIST_KEY = 'contexts_list'

/** never throws, always an array; hand edits happen */
export async function readWorkspaceList(): Promise<WorkspaceEntry[]> {
  try {
    const raw = await getSetting(LIST_KEY)
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
  await setSetting(LIST_KEY, JSON.stringify(list))
}
