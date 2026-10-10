/** the patch notes from GitHub's releases, kept so they still show offline and asked for at most every few hours */

import { app } from 'electron'
import { errorMessage } from '../shared/errors'
import { readReleases, type ReleaseNote, type ReleaseNotesState } from '../shared/releaseNotes'
import { getSetting, setSetting } from './db'

const RELEASES_API = 'https://api.github.com/repos/KDim67/checkpoint-app/releases?per_page=10'

/** GitHub lets an address without a token ask 60 times an hour; the notes change a few times a month */
const FRESH_FOR_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

/** local only: not in the sync allowlist, each machine fetches its own */
const CACHE_SETTING = 'release_notes_cache'

export interface NotesCache {
  releases: ReleaseNote[]
  fetchedAt: number
  /** GitHub's tag for the list, so an unchanged one comes back as 304 and costs nothing */
  etag?: string
}

export interface NotesDeps {
  fetch: typeof fetch
  now: () => number
  readCache: () => NotesCache | null
  writeCache: (cache: NotesCache) => void
}

function readStoredCache(): NotesCache | null {
  const raw = getSetting<unknown>(CACHE_SETTING, null)
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.fetchedAt !== 'number' || !Array.isArray(c.releases)) return null
  // stored by an earlier copy of this code, so read as carefully as GitHub's own answer
  const releases = (c.releases as unknown[]).filter((r): r is ReleaseNote =>
    !!r && typeof r === 'object' && ['version', 'title', 'notes', 'publishedAt', 'url'].every(k => typeof (r as Record<string, unknown>)[k] === 'string'))
  return { releases, fetchedAt: c.fetchedAt, ...(typeof c.etag === 'string' ? { etag: c.etag } : {}) }
}

const real: NotesDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  readCache: readStoredCache,
  writeCache: cache => setSetting(CACHE_SETTING, cache)
}

/** never rejects; when GitHub can't be reached the kept notes come back with the reason */
export async function loadReleaseNotes(deps: NotesDeps = real, { force = false }: { force?: boolean } = {}): Promise<ReleaseNotesState> {
  const cache = deps.readCache()
  const now = deps.now()
  if (cache && !force && now - cache.fetchedAt < FRESH_FOR_MS) return { releases: cache.releases, fetchedAt: cache.fetchedAt }

  try {
    const response = await deps.fetch(RELEASES_API, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub refuses requests that don't name themselves
        'User-Agent': `Checkpoint/${app.getVersion()}`,
        ...(cache?.etag ? { 'If-None-Match': cache.etag } : {})
      }
    })
    if (response.status === 304 && cache) {
      deps.writeCache({ ...cache, fetchedAt: now })
      return { releases: cache.releases, fetchedAt: now }
    }
    if (response.status === 403 || response.status === 429) throw new Error('GitHub is turning away requests for now. Try again later.')
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
    const releases = readReleases(await response.json())
    const etag = response.headers.get('etag')
    deps.writeCache({ releases, fetchedAt: now, ...(etag ? { etag } : {}) })
    return { releases, fetchedAt: now }
  } catch (err) {
    // a dropped connection says something unhelpful like "fetch failed"
    const message = err instanceof TypeError ? 'Couldn\'t reach GitHub.' : errorMessage(err, 'Couldn\'t reach GitHub.')
    return { releases: cache?.releases ?? [], fetchedAt: cache?.fetchedAt ?? null, error: message }
  }
}
