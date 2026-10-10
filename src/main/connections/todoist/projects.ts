/** which Todoist project each workspace follows, picked on the Connections tab */

import { getDb, getSetting, readContextList, setSetting } from '../../db'
import { isTodoistId } from '../../../shared/todoist'
import type { WorkspaceProjectView } from '../../../shared/connections'

/** synced, so every computer follows the same projects */
export const PROJECTS_KEY = 'todoist_projects'

export function readProjectChoices(): Record<string, string> {
  const raw = getSetting<unknown>(PROJECTS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && isTodoistId(value)) out[slug] = value
  }
  return out
}

export function setProjectChoice(slug: string, projectId: string | null): { ok: true } | { ok: false; reason: string } {
  if (projectId !== null && !isTodoistId(projectId)) return { ok: false, reason: 'That isn\'t a Todoist project.' }
  const next = readProjectChoices()
  if (projectId === null) delete next[slug]
  else next[slug] = projectId
  setSetting(PROJECTS_KEY, next)
  return { ok: true }
}

export function workspaceProjects(): WorkspaceProjectView[] {
  const choices = readProjectChoices()
  return (readContextList(getDb()) ?? []).map(entry => ({
    slug: entry.slug,
    name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
    project: choices[entry.slug] ?? null
  }))
}

/** project to workspace; a project two workspaces pick fills the first */
export function followedProjects(): Map<string, string> {
  const out = new Map<string, string>()
  for (const ws of workspaceProjects()) {
    if (ws.project && !out.has(ws.project)) out.set(ws.project, ws.slug)
  }
  return out
}
