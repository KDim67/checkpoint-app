import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { importObsidianVault, vaultName } from '../src/main/obsidianService'
import { getNotesDir, getMediaDir } from '../src/main/paths'

// a real vault through the real service; the stub pins home to a throwaway dir

let vault: string

const write = (relPath: string, content: string): void => {
  const full = join(vault, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

const noteNames = (): string[] => readdirSync(getNotesDir()).sort()
const noteBody = (title: string): string => readFileSync(join(getNotesDir(), `${title}.md`), 'utf8')

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'checkpoint-vault-'))
  for (const dir of [getNotesDir(), getMediaDir()]) {
    rmSync(dir, { recursive: true, force: true })
  }
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  for (const dir of [getNotesDir(), getMediaDir()]) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('importing a vault off disk', () => {
  it('flattens the tree into notes', () => {
    write('Daily/2026-01-01.md', '# Monday')
    write('Projects/Checkpoint.md', '# Checkpoint')

    const result = importObsidianVault(vault)

    expect(result.notesImported).toBe(2)
    expect(noteNames()).toEqual(['2026-01-01.md', 'Checkpoint.md'])
    expect(noteBody('Checkpoint')).toBe('# Checkpoint')
  })

  it('leaves the vault exactly as it found it', () => {
    write('Note.md', '---\ntags: [a]\n---\nbody')
    const before = readFileSync(join(vault, 'Note.md'), 'utf8')

    importObsidianVault(vault)

    expect(readFileSync(join(vault, 'Note.md'), 'utf8')).toBe(before)
  })

  it('skips the vault’s own configuration', () => {
    write('Real.md', 'content')
    write('.obsidian/workspace.json', '{}')
    write('.trash/Deleted.md', 'gone')

    importObsidianVault(vault)

    expect(noteNames()).toEqual(['Real.md'])
  })

  it('renames a collision and repoints the links that pointed at it', () => {
    write('Work/Index.md', 'work index')
    write('Home/Index.md', 'home index')
    write('Hub.md', 'See [[Index]].')

    const result = importObsidianVault(vault)

    expect(result.notesImported).toBe(3)
    expect(result.renamed).toHaveLength(1)

    // the link names whichever one was renamed
    const renamedTo = result.renamed[0].to
    expect(noteBody('Hub')).toBe(`See [[${renamedTo}]].`)
    expect(existsSync(join(getNotesDir(), `${renamedTo}.md`))).toBe(true)
  })

  it('copies an embedded image into the media folder and repoints the embed', () => {
    write('Note.md', 'Look: ![[diagram.png]]')
    write('assets/diagram.png', 'not really a png, but bytes are bytes')

    const result = importObsidianVault(vault)

    expect(result.attachmentsCopied).toBe(1)
    const copied = readdirSync(getMediaDir())
    expect(copied).toHaveLength(1)
    expect(noteBody('Note')).toBe(`Look: ![diagram](checkpoint-media://${copied[0]})`)
  })

  it('copies an image referenced by two notes only once', () => {
    write('One.md', '![[shared.png]]')
    write('Two.md', '![[shared.png]]')
    write('shared.png', 'bytes')

    const result = importObsidianVault(vault)

    expect(result.attachmentsCopied).toBe(1)
    expect(readdirSync(getMediaDir())).toHaveLength(1)
  })

  it('does not copy an image nobody links to', () => {
    write('Note.md', 'no embeds here')
    write('assets/unused.png', 'bytes')

    importObsidianVault(vault)

    expect(existsSync(getMediaDir()) ? readdirSync(getMediaDir()) : []).toHaveLength(0)
  })

  it('turns frontmatter tags into #tags and says what it dropped', () => {
    write('Note.md', '---\ntags:\n  - project/checkpoint\naliases:\n  - CP\n---\n# Real')

    const result = importObsidianVault(vault)

    expect(noteBody('Note')).toBe('#project-checkpoint\n\n# Real')
    expect(result.notes.join(' ')).toContain('aliases')
  })

  it('reports an embed whose file is not in the vault, and leaves it alone', () => {
    write('Note.md', '![[missing.png]]')

    const result = importObsidianVault(vault)

    expect(noteBody('Note')).toBe('![[missing.png]]')
    expect(result.notes.join(' ')).toContain('could not be found')
  })

  it('refuses a folder with no Markdown in it', () => {
    write('notes.txt', 'not markdown')
    expect(() => importObsidianVault(vault)).toThrow(/No Markdown/)
  })

  it('refuses a folder that is not there', () => {
    expect(() => importObsidianVault(join(vault, 'nope'))).toThrow(/no longer exists/)
  })

  it('says when it overwrote a note that already existed', () => {
    write('Note.md', 'first')
    importObsidianVault(vault)

    write('Note.md', 'second')
    const result = importObsidianVault(vault)

    expect(result.notesOverwritten).toBe(1)
    expect(result.notes.join(' ')).toContain('overwritten')
    expect(noteBody('Note')).toBe('second')
  })

  it('names the vault after its folder', () => {
    expect(vaultName(join('C:', 'Users', 'x', 'My Vault'))).toBe('My Vault')
  })
})
