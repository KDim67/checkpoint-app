/** the patch notes published with each release on GitHub, as the app shows them */

/** where the releases are; a release only links somewhere under here */
export const RELEASES_PAGE = 'https://github.com/KDim67/checkpoint-app/releases'

export interface ReleaseNote {
  /** without the v, as the app reports its own */
  version: string
  title: string
  /** markdown, as written on GitHub */
  notes: string
  /** ISO time, empty when GitHub left it out */
  publishedAt: string
  url: string
}

export interface ReleaseNotesState {
  /** newest first */
  releases: ReleaseNote[]
  /** when GitHub last answered; null when it never has */
  fetchedAt: number | null
  /** why the notes may be out of date or missing */
  error?: string
}

/** long enough for any real release, short enough that a runaway body can't swamp the page */
const MAX_NOTES = 20_000

const VERSION = /^\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/

/** numbers compared as numbers, so 1.10 is after 1.9; a pre-release comes before its release */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = a.replace(/^v/i, '').split(/-(.*)/s)
  const [coreB, preB] = b.replace(/^v/i, '').split(/-(.*)/s)
  const partsA = coreA.split('.').map(n => parseInt(n, 10) || 0)
  const partsB = coreB.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (!preA && !preB) return 0
  if (!preA) return 1
  if (!preB) return -1
  return preA.localeCompare(preB, undefined, { numeric: true })
}

/** the release's own heading only repeats the version the app already shows above it */
function withoutVersionHeading(body: string, tag: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const first = lines.findIndex(line => line.trim() !== '')
  if (first >= 0 && /^#{1,6}\s/.test(lines[first]) && lines[first].includes(tag.replace(/^v/i, ''))) {
    lines.splice(0, first + 1)
  }
  return lines.join('\n').trim()
}

/** GitHub's release list read defensively: published releases only, newest first */
export function readReleases(raw: unknown): ReleaseNote[] {
  if (!Array.isArray(raw)) return []
  const notes: ReleaseNote[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const r = entry as Record<string, unknown>
    if (typeof r.tag_name !== 'string' || r.draft === true || r.prerelease === true) continue
    const version = r.tag_name.replace(/^v/i, '')
    if (!VERSION.test(version)) continue
    notes.push({
      version,
      title: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.tag_name,
      notes: typeof r.body === 'string' ? withoutVersionHeading(r.body, r.tag_name).slice(0, MAX_NOTES) : '',
      publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
      url: typeof r.html_url === 'string' && r.html_url.startsWith(`${RELEASES_PAGE}/`) ? r.html_url : RELEASES_PAGE
    })
  }
  return notes.sort((a, b) => compareVersions(b.version, a.version))
}

/** every release after the one last seen, up to the one running, newest first */
export function notesSince(releases: ReleaseNote[], seen: string, current: string): ReleaseNote[] {
  return releases.filter(r => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
}

/**
 * the notes to open with after a launch: what's new since the version last shown; with none kept yet,
 * someone who has been through the tour used an earlier version and gets this one's, and a first install gets the tour
 */
export function whatsNewFor(releases: ReleaseNote[], { seen, current, toured }: { seen: string; current: string; toured: boolean }): ReleaseNote[] {
  if (seen) return notesSince(releases, seen, current)
  return toured ? releases.filter(r => compareVersions(r.version, current) === 0) : []
}
