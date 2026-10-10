/** which Linear team each workspace follows, and whose issues, picked on the Connections tab */

import { getDb, getSetting, readContextList, setSetting } from '../../db'
import { isLinearId } from '../../../shared/linear'
import type { WorkspaceTeamView } from '../../../shared/connections'

/** synced, so every computer follows the same teams */
export const TEAMS_KEY = 'linear_teams'

type Scope = WorkspaceTeamView['scope']

interface TeamChoice {
  team: string
  scope: Scope
}

export interface Follow {
  slug: string
  scope: Scope
}

export function readTeamChoices(): Record<string, TeamChoice> {
  const raw = getSetting<unknown>(TEAMS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, TeamChoice> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.team === 'string' && isLinearId(v.team)) out[slug] = { team: v.team, scope: v.scope === 'all' ? 'all' : 'assigned' }
  }
  return out
}

export function setTeamChoice(slug: string, team: string | null, scope: Scope): { ok: true } | { ok: false; reason: string } {
  if (team !== null && !isLinearId(team)) return { ok: false, reason: 'That isn\'t a Linear team.' }
  const next = readTeamChoices()
  if (team === null) delete next[slug]
  else next[slug] = { team, scope }
  setSetting(TEAMS_KEY, next)
  return { ok: true }
}

export function workspaceTeams(): WorkspaceTeamView[] {
  const choices = readTeamChoices()
  return (readContextList(getDb()) ?? []).map(entry => ({
    slug: entry.slug,
    name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
    team: choices[entry.slug]?.team ?? null,
    scope: choices[entry.slug]?.scope ?? 'assigned'
  }))
}

/** team to workspace; a team two workspaces pick fills the first */
export function followedTeams(): Map<string, Follow> {
  const out = new Map<string, Follow>()
  for (const ws of workspaceTeams()) {
    if (ws.team && !out.has(ws.team)) out.set(ws.team, { slug: ws.slug, scope: ws.scope })
  }
  return out
}
