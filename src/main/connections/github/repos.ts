/** which repository each workspace follows: picked on the Connections tab, or found from its folder's remote */

import { getDb, getSetting, readContextList, setSetting } from '../../db'
import { execFileQuiet } from '../../exec'
import { isRepoName, parseGitHubRemote } from '../../../shared/github'
import type { WorkspaceRepoView } from '../../../shared/connections'

/** synced, so every computer follows the same repositories */
export const REPOS_KEY = 'github_repos'

export type Scope = 'assigned' | 'all'

interface RepoChoice {
  /** null: whatever the workspace's folder points at */
  repo: string | null
  scope: Scope
}

export function readRepoChoices(): Record<string, RepoChoice> {
  const raw = getSetting<unknown>(REPOS_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, RepoChoice> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    out[slug] = {
      repo: typeof v.repo === 'string' && isRepoName(v.repo) ? v.repo : null,
      scope: v.scope === 'all' ? 'all' : 'assigned'
    }
  }
  return out
}

/** a name that isn't owner/repo is refused rather than kept */
export function setRepoChoice(slug: string, repo: string | null, scope: Scope): { ok: true } | { ok: false; reason: string } {
  const name = repo === null ? null : repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  if (name !== null && name !== '' && !isRepoName(name)) return { ok: false, reason: `"${repo}" isn't a repository name like owner/repo.` }
  setSetting(REPOS_KEY, { ...readRepoChoices(), [slug]: { repo: name || null, scope } })
  return { ok: true }
}

export type ReadRemote = (folder: string) => Promise<string>

/** the origin remote, or nothing for a folder that isn't a repository or has git missing */
export const gitOrigin: ReadRemote = folder => execFileQuiet('git', ['-C', folder, 'remote', 'get-url', 'origin'], 5000)

export async function workspaceRepos(readOnly: string[], readRemote: ReadRemote = gitOrigin): Promise<WorkspaceRepoView[]> {
  const choices = readRepoChoices()
  const views: WorkspaceRepoView[] = []
  for (const entry of readContextList(getDb()) ?? []) {
    const choice = choices[entry.slug]
    let repo = choice?.repo ?? null
    let source: WorkspaceRepoView['source'] = repo ? 'chosen' : null
    if (!repo && typeof entry.gitPath === 'string' && entry.gitPath) {
      repo = parseGitHubRemote(await readRemote(entry.gitPath))
      source = repo ? 'folder' : null
    }
    views.push({
      slug: entry.slug,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.slug,
      repo,
      source,
      scope: choice?.scope ?? 'assigned',
      readOnly: repo !== null && readOnly.includes(repo)
    })
  }
  return views
}
