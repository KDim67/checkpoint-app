import { describe, expect, it } from 'vitest'
import { isObsidianOpen } from '../src/main/openExternal'
import { linkOf } from '../src/shared/connections'

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
