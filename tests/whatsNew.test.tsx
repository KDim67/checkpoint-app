// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReleaseNote, ReleaseNotesState } from '../src/shared/releaseNotes'

const settings = new Map<string, unknown>()
vi.mock('../src/renderer/src/lib/settings', () => ({
  getStringSetting: async (key: string, fallback: string) => (settings.has(key) ? settings.get(key) : fallback),
  getBoolSetting: async (key: string, fallback: boolean) => (settings.has(key) ? settings.get(key) : fallback),
  setStringSetting: vi.fn(async (key: string, value: string) => { settings.set(key, value) })
}))

import { useWhatsNew } from '../src/renderer/src/lib/whatsNew'
import WhatsNewDialog from '../src/renderer/src/components/WhatsNewDialog'
import WhatsNew from '../src/renderer/src/components/settings/WhatsNew'
import { LAST_SEEN_VERSION_KEY, ONBOARDING_SEEN_KEY } from '../src/renderer/src/lib/firstRun'

const note = (version: string, notes = `## Walls\n\n- New in ${version}, see [the docs](https://example.com/docs)`): ReleaseNote => ({
  version, title: `Checkpoint v${version}`, notes, publishedAt: '2026-09-25T18:45:22Z', url: `https://github.com/KDim67/checkpoint-app/releases/tag/v${version}`
})

let running = '1.1.1'
let answers: ReleaseNotesState[] = []
const releaseNotes = vi.fn(async () => answers.shift() ?? { releases: [], fetchedAt: null })
const openExternal = vi.fn(async () => {})

beforeEach(() => {
  settings.clear()
  running = '1.1.1'
  answers = []
  releaseNotes.mockClear()
  openExternal.mockClear()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    app: { getVersion: async () => running, releaseNotes, openExternal }
  }
})
afterEach(cleanup)

describe('opening with what\'s new after an update', () => {
  it('shows the news since the last version seen, and remembers once it is closed', async () => {
    settings.set(LAST_SEEN_VERSION_KEY, '1.1.0')
    answers = [{ releases: [note('1.1.1'), note('1.1.0')], fetchedAt: 1 }]
    const { result } = renderHook(() => useWhatsNew())
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.version).toBe('1.1.1')
    expect(result.current?.releases.map(r => r.version)).toStrictEqual(['1.1.1'])

    await act(async () => { result.current?.dismiss() })
    expect(settings.get(LAST_SEEN_VERSION_KEY)).toBe('1.1.1')
    expect(result.current).toBeNull()
  })

  it('stays quiet on a first install, which the tour welcomes, and starts counting from it', async () => {
    const { result } = renderHook(() => useWhatsNew())
    await waitFor(() => expect(settings.get(LAST_SEEN_VERSION_KEY)).toBe('1.1.1'))
    expect(result.current).toBeNull()
    expect(releaseNotes).not.toHaveBeenCalled()
  })

  it('shows this version\'s notes to someone who used the app before versions were kept', async () => {
    settings.set(ONBOARDING_SEEN_KEY, true)
    answers = [{ releases: [note('1.1.1'), note('1.1.0')], fetchedAt: 1 }]
    const { result } = renderHook(() => useWhatsNew())
    await waitFor(() => expect(result.current?.releases.map(r => r.version)).toStrictEqual(['1.1.1']))
  })

  it('asks GitHub again when the notes it kept are from before this version came out', async () => {
    settings.set(LAST_SEEN_VERSION_KEY, '1.1.0')
    answers = [{ releases: [note('1.1.0')], fetchedAt: 1 }, { releases: [note('1.1.1'), note('1.1.0')], fetchedAt: 2 }]
    const { result } = renderHook(() => useWhatsNew())
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(releaseNotes.mock.calls).toStrictEqual([[], [true]])
  })

  it('tries again next launch when GitHub can\'t be reached, rather than skipping the news', async () => {
    settings.set(LAST_SEEN_VERSION_KEY, '1.1.0')
    answers = [{ releases: [], fetchedAt: null, error: 'Couldn\'t reach GitHub.' }, { releases: [], fetchedAt: null, error: 'Couldn\'t reach GitHub.' }]
    renderHook(() => useWhatsNew())
    await waitFor(() => expect(releaseNotes).toHaveBeenCalledTimes(2))
    expect(settings.get(LAST_SEEN_VERSION_KEY)).toBe('1.1.0')
  })

  it('asks for nothing on the same version as last time', async () => {
    settings.set(LAST_SEEN_VERSION_KEY, '1.1.1')
    const { result } = renderHook(() => useWhatsNew())
    await act(async () => {})
    expect(result.current).toBeNull()
    expect(releaseNotes).not.toHaveBeenCalled()
  })
})

describe('the what\'s new window', () => {
  it('shows the notes with their links opening in the browser, and closes on Got it', async () => {
    const onClose = vi.fn()
    render(<WhatsNewDialog version="1.1.1" releases={[note('1.1.1')]} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'What\'s new in Checkpoint 1.1.1' })).not.toBeNull()
    expect(screen.getByText(/New in 1\.1\.1/)).not.toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'the docs' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('names each version when there are several to catch up on', () => {
    render(<WhatsNewDialog version="1.2.0" releases={[note('1.2.0'), note('1.1.1')]} onClose={() => {}} />)
    // the window's own title names the newest too, so only the per-version headings are counted
    expect(screen.getByRole('heading', { level: 3, name: /1\.2\.0/ })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: /1\.1\.1/ })).not.toBeNull()
  })

  it('never follows a link that isn\'t a web address', () => {
    render(<WhatsNewDialog version="1.1.1" releases={[note('1.1.1', '[run me](javascript:alert(1))')]} onClose={() => {}} />)
    const link = screen.getByText('run me').closest('a') as HTMLAnchorElement
    expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/)
    fireEvent.click(link)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('what\'s new in About', () => {
  it('shows the latest notes, marks the version you\'re on, and keeps earlier ones a click away', async () => {
    answers = [{ releases: [note('1.2.0'), note('1.1.1'), note('1.1.0')], fetchedAt: 1 }]
    await act(async () => { render(<WhatsNew />) })
    expect(screen.getByText(/New in 1\.2\.0/)).not.toBeNull()
    expect(screen.getByText('Newer than yours')).not.toBeNull()
    expect(screen.getByText('Earlier versions')).not.toBeNull()
    expect(screen.getByText('You\'re on this version')).not.toBeNull()
  })

  it('asks GitHub again on request', async () => {
    answers = [{ releases: [note('1.1.1')], fetchedAt: 1 }, { releases: [note('1.1.1')], fetchedAt: 2 }]
    await act(async () => { render(<WhatsNew />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check GitHub again' })) })
    expect(releaseNotes.mock.calls).toStrictEqual([[false], [true]])
  })

  it('says when it is showing kept notes because GitHub couldn\'t be reached', async () => {
    answers = [{ releases: [note('1.1.1')], fetchedAt: Date.UTC(2026, 8, 25), error: 'Couldn\'t reach GitHub.' }]
    await act(async () => { render(<WhatsNew />) })
    expect(screen.getByRole('status').textContent).toMatch(/Couldn't reach GitHub\. Showing the notes kept on /)
    expect(screen.getByText(/New in 1\.1\.1/)).not.toBeNull()
  })
})
