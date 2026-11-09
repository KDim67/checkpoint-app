import { describe, expect, it, vi } from 'vitest'
import { isObsidianOpen, openExternalSafely } from '../src/main/openExternal'
import { linkOf } from '../src/shared/connections'
import { shell } from 'electron'

const url = (text: string): URL => new URL(text)

describe('which obsidian links may be opened', () => {
  it('opens a note by vault and file, and nothing else Obsidian or a plugin can be told to do', () => {
    expect(isObsidianOpen(url('obsidian://open?vault=My%20Vault&file=Projects%2FGame'))).toBe(true)
    expect(isObsidianOpen(url('obsidian://open?vault=My%20Vault&file=Game&path=C%3A%2Fother'))).toBe(false)
    expect(isObsidianOpen(url('obsidian://open?path=C%3A%2FUsers%2Fme%2Fnote.md'))).toBe(false)
    expect(isObsidianOpen(url('obsidian://advanced-uri?vault=v&commandid=app%3Adelete-file'))).toBe(false)
    expect(isObsidianOpen(url('obsidian://new?vault=v&file=x&content=y'))).toBe(false)
    expect(isObsidianOpen(url('https://obsidian.md/'))).toBe(false)
  })

  it('is the only kind a card linked to Obsidian carries', () => {
    const link = (u: string) => linkOf(JSON.stringify({ link: { service: 'obsidian', id: '^cp-00000001', url: u, state: 'open', labels: [] } }))
    expect(link('obsidian://open?vault=My%20Vault&file=Inbox')?.url).toBe('obsidian://open?vault=My%20Vault&file=Inbox')
    expect(link('obsidian://advanced-uri?vault=v&commandid=x')).toBeNull()
    expect(link('https://example.com/')).toBeNull()
  })
})

describe('openExternalSafely', () => {
  it('opens web URLs via shell.openExternal', () => {
    const spy = vi.spyOn(shell, 'openExternal')
    openExternalSafely('https://github.com')
    expect(spy).toHaveBeenCalledWith('https://github.com/')
  })

  it('routes file:// URLs to shell.openPath', () => {
    const spy = vi.spyOn(shell, 'openPath')
    openExternalSafely('file:///C:/Users/dimit/Documents/test.pdf')
    expect(spy).toHaveBeenCalled()
  })

  it('routes cheatsheet:// URLs to shell.openPath', () => {
    const spy = vi.spyOn(shell, 'openPath')
    openExternalSafely('cheatsheet://show/Unity_Guide.pdf')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unity_Guide.pdf'))
  })
})
