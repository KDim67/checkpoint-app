import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isInside, listNotes, MAX_NOTE_BYTES, vaultOf, writeNote } from '../src/main/connections/obsidian/vault'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-vault-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (rel: string, text: string): string => {
  const path = join(dir, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  return path
}

describe('a followed folder', () => {
  it('lists its notes, leaving out hidden folders, the trash, other files and huge notes', async () => {
    put('Inbox.md', '- [ ] a')
    put('Projects/Game.md', '- [ ] b')
    put('.obsidian/workspace.md', 'x')
    put('.trash/Old.md', 'x')
    put('Projects/art.png', 'x')
    put('Log.md', 'x'.repeat(MAX_NOTE_BYTES + 1))
    const names = (await listNotes(dir)).map(n => n.path.slice(dir.length + 1).replace(/\\/g, '/')).sort()
    expect(names).toStrictEqual(['Inbox.md', 'Projects/Game.md'])
  })

  it('never follows a link out of the folder', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'checkpoint-outside-'))
    writeFileSync(join(outside, 'Secret.md'), '- [ ] not yours')
    try {
      symlinkSync(outside, join(dir, 'linked'), 'junction')
    } catch {
      rmSync(outside, { recursive: true, force: true })
      return
    }
    expect((await listNotes(dir)).map(n => n.path)).toStrictEqual([])
    rmSync(outside, { recursive: true, force: true })
  })

  it('knows what is inside it', () => {
    expect(isInside(dir, join(dir, 'a', 'b.md'))).toBe(true)
    expect(isInside(dir, join(dir, '..', 'elsewhere.md'))).toBe(false)
    expect(isInside(join(dir, 'a'), join(dir, 'ab', 'c.md'))).toBe(false)
  })

  it('finds the vault a folder is in by Obsidian\'s settings folder, or uses the folder itself', () => {
    mkdirSync(join(dir, 'My Vault', '.obsidian'), { recursive: true })
    mkdirSync(join(dir, 'My Vault', 'Projects'), { recursive: true })
    expect(vaultOf(join(dir, 'My Vault', 'Projects')).name).toBe('My Vault')
    mkdirSync(join(dir, 'Loose'))
    expect(vaultOf(join(dir, 'Loose'))).toMatchObject({ name: 'Loose' })
  })
})

describe('writing a note', () => {
  it('replaces it whole, leaving nothing behind', async () => {
    const path = put('Inbox.md', '- [ ] a\n')
    expect(await writeNote(dir, path, '- [x] a\n', statSync(path).mtimeMs)).toBe('written')
    expect(readFileSync(path, 'utf8')).toBe('- [x] a\n')
    expect(readdirSync(dir)).toStrictEqual(['Inbox.md'])
  })

  it('leaves a note alone that changed since it was read', async () => {
    const path = put('Inbox.md', '- [ ] a\n')
    const readAt = statSync(path).mtimeMs
    writeFileSync(path, '- [ ] a\n- [ ] typed meanwhile\n')
    utimesSync(path, new Date(), new Date(readAt + 5000))
    expect(await writeNote(dir, path, '- [x] a\n', readAt)).toBe('changed')
    expect(readFileSync(path, 'utf8')).toContain('typed meanwhile')
  })

  it('refuses anything outside the folder', async () => {
    const outside = join(dir, '..', 'not-followed.md')
    await expect(writeNote(join(dir, 'sub'), outside, 'x', 0)).rejects.toThrow('outside the folder')
  })
})
