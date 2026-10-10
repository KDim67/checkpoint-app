import { describe, expect, it, vi } from 'vitest'
import { compareVersions, notesSince, readReleases, whatsNewFor, type ReleaseNote } from '../src/shared/releaseNotes'
import { loadReleaseNotes, type NotesCache } from '../src/main/releaseNotes'

/** a release as GitHub's API hands it back, the fields the app reads */
const release = (tag: string, over: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `Checkpoint ${tag}`,
  body: `# ${tag}\n\n## Walls\n\n- Something new in ${tag}`,
  published_at: '2026-09-25T18:45:22Z',
  html_url: `https://github.com/KDim67/checkpoint-app/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...over
})

describe('reading GitHub\'s releases', () => {
  it('keeps published releases newest first, without the heading that only repeats the version', () => {
    const notes = readReleases([release('v1.1.0'), release('v1.1.1')])
    expect(notes.map(n => n.version)).toStrictEqual(['1.1.1', '1.1.0'])
    expect(notes[0]).toStrictEqual({
      version: '1.1.1',
      title: 'Checkpoint v1.1.1',
      notes: '## Walls\n\n- Something new in v1.1.1',
      publishedAt: '2026-09-25T18:45:22Z',
      url: 'https://github.com/KDim67/checkpoint-app/releases/tag/v1.1.1'
    })
  })

  it('leaves out drafts, pre-releases and anything it can\'t read', () => {
    const notes = readReleases([
      release('v1.2.0', { draft: true }),
      release('v1.2.0-beta.1', { prerelease: true }),
      { tag_name: 42 },
      'not a release',
      release('v1.1.1', { body: null, name: '' })
    ])
    expect(notes).toStrictEqual([{ version: '1.1.1', title: 'v1.1.1', notes: '', publishedAt: '2026-09-25T18:45:22Z', url: 'https://github.com/KDim67/checkpoint-app/releases/tag/v1.1.1' }])
    expect(readReleases({ message: 'Not Found' })).toStrictEqual([])
  })

  it('only links to GitHub, whatever a release says its page is', () => {
    expect(readReleases([release('v1.1.1', { html_url: 'javascript:alert(1)' })])[0].url).toBe('https://github.com/KDim67/checkpoint-app/releases')
  })
})

describe('comparing versions', () => {
  it('reads them as numbers, with or without the v', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareVersions('v1.1.1', '1.1.1')).toBe(0)
    expect(compareVersions('1.1', '1.1.1')).toBeLessThan(0)
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0)
  })
})

describe('what is new since the last version seen', () => {
  const all: ReleaseNote[] = readReleases(['v1.2.0', 'v1.1.1', 'v1.1.0', 'v1.0.2'].map(t => release(t)))

  it('is every release after it up to the one running, newest first', () => {
    expect(notesSince(all, '1.0.2', '1.2.0').map(n => n.version)).toStrictEqual(['1.2.0', '1.1.1', '1.1.0'])
  })

  it('is nothing on the same version, or after going back to an older one', () => {
    expect(notesSince(all, '1.2.0', '1.2.0')).toStrictEqual([])
    expect(notesSince(all, '1.2.0', '1.1.1')).toStrictEqual([])
  })
})

describe('what to open with after a launch', () => {
  const all: ReleaseNote[] = readReleases(['v1.2.0', 'v1.1.1', 'v1.1.0'].map(t => release(t)))

  it('is the news since the version last shown', () => {
    expect(whatsNewFor(all, { seen: '1.1.0', current: '1.2.0', toured: true }).map(n => n.version)).toStrictEqual(['1.2.0', '1.1.1'])
  })

  it('is nothing on a first install, which the tour welcomes instead', () => {
    expect(whatsNewFor(all, { seen: '', current: '1.2.0', toured: false })).toStrictEqual([])
  })

  it("is this version's notes for someone who used the app before versions were kept", () => {
    expect(whatsNewFor(all, { seen: '', current: '1.2.0', toured: true }).map(n => n.version)).toStrictEqual(['1.2.0'])
  })
})

describe('fetching the notes', () => {
  const NOW = 1_800_000_000_000
  const HOUR = 3_600_000

  const deps = (over: { cache?: NotesCache | null; response?: Response | Error } = {}) => {
    let saved: NotesCache | null = over.cache ?? null
    const fetch = vi.fn(async () => {
      if (over.response instanceof Error) throw over.response
      return over.response ?? new Response(JSON.stringify([release('v1.1.1')]), { status: 200, headers: { etag: '"abc"' } })
    })
    return {
      fetch,
      now: () => NOW,
      readCache: () => saved,
      writeCache: (next: NotesCache) => { saved = next },
      saved: () => saved
    }
  }

  it('fetches once and keeps them, with the tag GitHub uses to say nothing changed', async () => {
    const d = deps()
    const state = await loadReleaseNotes(d)
    expect(state.releases.map(r => r.version)).toStrictEqual(['1.1.1'])
    expect(state.fetchedAt).toBe(NOW)
    expect(d.saved()).toMatchObject({ fetchedAt: NOW, etag: '"abc"' })
    const [, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^Checkpoint\//)
  })

  it('answers from what it kept while that is recent, without asking GitHub', async () => {
    const d = deps({ cache: { releases: readReleases([release('v1.1.0')]), fetchedAt: NOW - HOUR } })
    const state = await loadReleaseNotes(d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(state.releases.map(r => r.version)).toStrictEqual(['1.1.0'])
  })

  it('asks again once it is old, and keeps what it had when GitHub says nothing changed', async () => {
    const kept = readReleases([release('v1.1.0')])
    const d = deps({ cache: { releases: kept, fetchedAt: NOW - 7 * HOUR, etag: '"old"' }, response: new Response(null, { status: 304 }) })
    const state = await loadReleaseNotes(d)
    const [, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"old"')
    expect(state).toStrictEqual({ releases: kept, fetchedAt: NOW })
  })

  it('asks again when told to, however recent', async () => {
    const d = deps({ cache: { releases: [], fetchedAt: NOW - HOUR } })
    await loadReleaseNotes(d, { force: true })
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows what it kept when GitHub can\'t be reached, and says so', async () => {
    const kept = readReleases([release('v1.1.0')])
    const offline = await loadReleaseNotes(deps({ cache: { releases: kept, fetchedAt: NOW - 9 * HOUR }, response: new TypeError('fetch failed') }))
    expect(offline).toStrictEqual({ releases: kept, fetchedAt: NOW - 9 * HOUR, error: 'Couldn\'t reach GitHub.' })

    const limited = await loadReleaseNotes(deps({ response: new Response('{}', { status: 403 }) }))
    expect(limited).toStrictEqual({ releases: [], fetchedAt: null, error: 'GitHub is turning away requests for now. Try again later.' })
  })
})
