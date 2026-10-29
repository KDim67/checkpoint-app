import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the notes list and search over a folder of markdown files, read again only where a file changed

const paths = vi.hoisted(() => ({ dir: '' }))
vi.mock('../src/main/paths', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/main/paths')>()),
  getConfigDir: () => paths.dir,
  getNotesDir: () => join(paths.dir, 'notes'),
  ensureDir: (p: string) => mkdirSync(p, { recursive: true })
}))
vi.mock('../src/main/db', () => ({ clearTombstone: vi.fn(), recordTombstone: vi.fn() }))

const notesDir = (): string => join(paths.dir, 'notes')
const put = (title: string, content: string): void => writeFileSync(join(notesDir(), `${title}.md`), content)
/** a file another program changed, dated a moment later so its time moves */
const putLater = (title: string, content: string): void => {
  const file = join(notesDir(), `${title}.md`)
  const before = statSync(file).mtime
  writeFileSync(file, content)
  utimesSync(file, before, new Date(before.getTime() + 2000))
}

let service: typeof import('../src/main/notesFsService')
let reads: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  paths.dir = mkdtempSync(join(tmpdir(), 'checkpoint-notes-'))
  mkdirSync(notesDir(), { recursive: true })
  // a fresh module each test, so nothing read in one is remembered in the next
  vi.resetModules()
  service = await import('../src/main/notesFsService')
  reads = vi.spyOn(fs.promises, 'readFile')
})

afterEach(() => {
  reads.mockRestore()
  rmSync(paths.dir, { recursive: true, force: true })
})

describe('the notes list', () => {
  it('describes every note, newest first', async () => {
    put('Plans', '# Plans\n\nShip the [[Release]] #work')
    put('Ideas', 'Try a #game jam')
    utimesSync(join(notesDir(), 'Ideas.md'), new Date(), new Date(Date.now() + 5000))
    const list = await service.listNotes()
    expect(list.map(n => n.title)).toEqual(['Ideas', 'Plans'])
    expect(list[1]).toMatchObject({ tags: ['#work'], links: ['Release'], excerpt: 'Ship the Release #work' })
  })

  it('reads each file once, and not again until it changes', async () => {
    for (let i = 0; i < 40; i++) put(`Note ${i}`, `Text ${i}`)
    await service.listNotes()
    expect(reads).toHaveBeenCalledTimes(40)
    await service.listNotes()
    await service.searchNotes('text')
    expect(reads).toHaveBeenCalledTimes(40)
  })

  it('sees a change made by another program', async () => {
    put('Plans', 'Draft #old')
    await service.listNotes()
    putLater('Plans', 'Final #new')
    const [plans] = await service.listNotes()
    expect(plans.tags).toEqual(['#new'])
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('drops a note whose file is gone, and picks up a new one', async () => {
    put('Old', 'gone soon')
    await service.listNotes()
    unlinkSync(join(notesDir(), 'Old.md'))
    put('New', 'just made')
    expect((await service.listNotes()).map(n => n.title)).toEqual(['New'])
    expect((await service.searchNotes('gone'))).toEqual([])
  })

  it('shows its own save even where the time and size come out the same', async () => {
    put('Plans', 'aaaa')
    await service.listNotes()
    const stamp = statSync(join(notesDir(), 'Plans.md')).mtime
    await service.writeNote('Plans', 'bbbb')
    // a disk that keeps times to the second
    utimesSync(join(notesDir(), 'Plans.md'), stamp, stamp)
    expect((await service.listNotes())[0].excerpt).toBe('bbbb')
  })

  it('leaves out a file it cannot read, rather than showing no notes at all', async () => {
    put('Fine', 'readable')
    put('Broken', 'unreadable')
    reads.mockImplementation(async (file: unknown) => {
      if (String(file).endsWith('Broken.md')) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      return 'readable'
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await service.listNotes()).map(n => n.title)).toEqual(['Fine'])
    expect(errors).toHaveBeenCalledOnce()
    errors.mockRestore()
  })
})

describe('searching notes', () => {
  it('ranks title matches first, then by how often the text matches, with a snippet around the first', async () => {
    put('Pipeline', 'about something else')
    put('Builds', 'the pipeline broke, then the pipeline was fixed')
    put('Other', 'nothing here')
    const results = await service.searchNotes('Pipeline')
    expect(results.map(r => r.title)).toEqual(['Pipeline', 'Builds'])
    expect(results[1]).toMatchObject({ matchCount: 2, titleMatch: false })
    expect(results[1].snippet).toContain('pipeline broke')
  })

  it('finds text in a note too large to keep, by reading it when asked', async () => {
    put('Huge', `${'filler '.repeat(80_000)}needle`)
    await service.listNotes()
    const [hit] = await service.searchNotes('needle')
    expect(hit.title).toBe('Huge')
  })
})
