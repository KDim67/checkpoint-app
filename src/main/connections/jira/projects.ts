/** which Jira project each workspace follows, and whose issues, picked on the Connections tab */

import { getDb, getSetting, readContextList, setSetting } from '../../db'
import { isJiraId } from '../../../shared/jira'
import type { WorkspaceJiraView } from '../../../shared/connections'

/** synced, so every computer follows the same projects */
export const JIRA_PROJECTS_KEY = 'jira_projects'

type Scope = WorkspaceJiraView['scope']

export interface JiraFollow {
  slug: string
  scope: Scope
}

function readChoices(): Record<string, { project: string; scope: Scope }> {
  const raw = getSetting<unknown>(JIRA_PROJECTS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, { project: string; scope: Scope }> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.project === 'string' && isJiraId(v.project)) out[slug] = { project: v.project, scope: v.scope === 'all' ? 'all' : 'assigned' }
  }
  return out
}

export function setJiraProjectChoice(slug: string, project: string | null, scope: Scope): { ok: true } | { ok: false; reason: string } {
  if (project !== null && !isJiraId(project)) return { ok: false, reason: 'That isn\'t a Jira project.' }
  const next = readChoices()
  if (project === null) delete next[slug]
  else next[slug] = { project, scope }
  setSetting(JIRA_PROJECTS_KEY, next)
  return { ok: true }
}

export function workspaceJiraProjects(): WorkspaceJiraView[] {
  const choices = readChoices()
  return (readContextList(getDb()) ?? []).map(entry => ({
    slug: entry.slug,
    name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
    project: choices[entry.slug]?.project ?? null,
    scope: choices[entry.slug]?.scope ?? 'assigned'
  }))
}

/** project to workspace; a project two workspaces pick fills the first */
export function followedJiraProjects(): Map<string, JiraFollow> {
  const out = new Map<string, JiraFollow>()
  for (const ws of workspaceJiraProjects()) {
    if (ws.project && !out.has(ws.project)) out.set(ws.project, { slug: ws.slug, scope: ws.scope })
  }
  return out
}
