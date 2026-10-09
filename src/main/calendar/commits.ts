/** commits in range for workspaces linked to a repository; git runs with arguments, never through a shell */

import { existsSync } from 'fs'
import { execFileAsync } from '../exec'
import type { CalendarEntry } from '../../shared/calendar'
import type { Range } from './sources'

const LIMIT = 500
const TIMEOUT_MS = 10_000

export type RunGit = (args: string[]) => Promise<string>

const realGit: RunGit = args => execFileAsync('git', args, TIMEOUT_MS)

/** a missing folder or a folder that isn't a repository says so, instead of an empty layer that looks like no commits */
export async function commitEntries(
  range: Range,
  repositories: { workspace: string; path: string }[],
  git: RunGit = realGit
): Promise<{ entries: CalendarEntry[]; problems: string[] }> {
  const entries: CalendarEntry[] = []
  const problems: string[] = []
  for (const { workspace, path } of repositories) {
    if (!existsSync(path)) {
      problems.push(`The repository for ${workspace} is not at ${path} any more.`)
      continue
    }
    let out: string
    try {
      out = await git([
        '-C', path, 'log', '--all', `--since=@${Math.floor(range.from / 1000)}`, `--until=@${Math.ceil(range.to / 1000)}`,
        '-n', String(LIMIT), '--pretty=format:%H%x09%h%x09%an%x09%at%x09%s'
      ])
    } catch (err) {
      problems.push(`Couldn't read the commits for ${workspace}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      continue
    }
    for (const line of out.split('\n')) {
      const [hash, short, author, seconds, ...subject] = line.split('\t')
      const at = Number(seconds) * 1000
      if (!hash || !Number.isFinite(at)) continue
      entries.push({
        id: `commit:${workspace}:${hash}`,
        layer: 'commits',
        title: subject.join('\t') || short,
        start: at,
        end: null,
        allDay: false,
        days: 1,
        workspace,
        color: null,
        movable: false,
        state: null,
        ref: { kind: 'commit', workspace, hash },
        detail: `${author} ${short}`
      })
    }
  }
  return { entries, problems }
}
