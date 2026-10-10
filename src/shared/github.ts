/** naming GitHub repositories and issues the same way on every computer */

import { cardIdFor } from './connections'

/** where someone makes a fine-grained key: Issues read and write, on the repositories they pick */
export const GITHUB_KEY_PAGE = 'https://github.com/settings/personal-access-tokens/new'

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

export const isRepoName = (text: string): boolean => REPO.test(text) && !text.split('/')[1].startsWith('.')

/** owner/repo from a remote on github.com, in its https or ssh forms; null for any other host */
export function parseGitHubRemote(remote: string): string | null {
  const text = remote.trim()
  const scp = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(text)
  if (scp) return isRepoName(scp[1]) ? scp[1] : null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/')
  if (parts.length !== 2) return null
  const repo = `${parts[0]}/${parts[1]}`
  return isRepoName(repo) ? repo : null
}

export const issueRemoteId = (repo: string, number: number): string => `${repo}#${number}`

/** the same issue becomes the same card on every computer, so sync merges it instead of doubling it */
export const issueCardId = (repo: string, number: number): string => cardIdFor('github', issueRemoteId(repo, number))
