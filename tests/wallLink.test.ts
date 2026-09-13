import { describe, it, expect } from 'vitest'
import {
  describeLink,
  isLinkable,
  itemLink,
  linkSegments,
  normalizeLinkInput,
  parseWallLink,
  pastedLink,
  remapItemLinks
} from '../src/shared/wallLink'

describe('parseWallLink', () => {
  it('reads a web address and names its host without the www', () => {
    expect(parseWallLink('https://www.github.com/KDim67/checkpoint-app')).toEqual({
      type: 'url', url: 'https://www.github.com/KDim67/checkpoint-app', host: 'github.com'
    })
  })

  it('reads a mailto link and names the address', () => {
    expect(parseWallLink('mailto:hello@example.com')).toEqual({
      type: 'url', url: 'mailto:hello@example.com', host: 'hello@example.com'
    })
  })

  it('reads a link to an item on a wall', () => {
    expect(parseWallLink('wall:main/w-abc-12')).toEqual({ type: 'item', wallId: 'main', itemId: 'w-abc-12' })
  })

  it('refuses what main would refuse to open', () => {
    // main only opens http, https and mailto
    expect(parseWallLink('javascript:alert(1)')).toBeNull()
    expect(parseWallLink('file:///C:/Windows/System32')).toBeNull()
    expect(parseWallLink('ftp://example.com')).toBeNull()
  })

  it('refuses junk and half-written item links', () => {
    expect(parseWallLink('')).toBeNull()
    expect(parseWallLink('not a link')).toBeNull()
    expect(parseWallLink('wall:main')).toBeNull()
    expect(parseWallLink('wall:main/a/b')).toBeNull()
    expect(parseWallLink(42)).toBeNull()
  })
})

describe('itemLink', () => {
  it('writes what parseWallLink reads', () => {
    expect(parseWallLink(itemLink('k3x9', 'w-lx8-abcde'))).toEqual({ type: 'item', wallId: 'k3x9', itemId: 'w-lx8-abcde' })
  })
})

describe('normalizeLinkInput', () => {
  it('keeps a full address', () => {
    expect(normalizeLinkInput('  https://example.com/a?b=1#c  ')).toBe('https://example.com/a?b=1#c')
  })

  it('assumes https for a typed domain', () => {
    expect(normalizeLinkInput('github.com/KDim67')).toBe('https://github.com/KDim67')
    expect(normalizeLinkInput('www.example.com')).toBe('https://www.example.com/')
    expect(normalizeLinkInput('localhost:5173')).toBeNull()
  })

  it('keeps a copied item link', () => {
    expect(normalizeLinkInput('wall:main/w-1')).toBe('wall:main/w-1')
  })

  it('refuses empty input, spaces and unsafe schemes', () => {
    expect(normalizeLinkInput('   ')).toBeNull()
    expect(normalizeLinkInput('my notes')).toBeNull()
    expect(normalizeLinkInput('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkInput('notes')).toBeNull()
  })
})

describe('pastedLink', () => {
  it('takes a pasted address or item link', () => {
    expect(pastedLink('https://example.com')).toBe('https://example.com/')
    expect(pastedLink(' www.example.com/x\n')).toBe('https://www.example.com/x')
    expect(pastedLink('wall:main/w-1')).toBe('wall:main/w-1')
  })

  it('leaves ordinary text alone, even when it looks like a filename', () => {
    // a pasted "notes.md" must stay text
    expect(pastedLink('notes.md')).toBeNull()
    expect(pastedLink('see https://example.com')).toBeNull()
    expect(pastedLink('')).toBeNull()
  })
})

describe('linkSegments', () => {
  it('splits addresses out of prose', () => {
    expect(linkSegments('docs at https://example.com/a and www.test.org.')).toEqual([
      { text: 'docs at ' },
      { text: 'https://example.com/a', url: 'https://example.com/a' },
      { text: ' and ' },
      { text: 'www.test.org', url: 'https://www.test.org/' },
      { text: '.' }
    ])
  })

  it('keeps a closing bracket that belongs to the address', () => {
    expect(linkSegments('(see https://en.wikipedia.org/wiki/Tree_(graph))')).toEqual([
      { text: '(see ' },
      { text: 'https://en.wikipedia.org/wiki/Tree_(graph)', url: 'https://en.wikipedia.org/wiki/Tree_(graph)' },
      { text: ')' }
    ])
  })

  it('returns plain text as one segment', () => {
    expect(linkSegments('nothing to see')).toEqual([{ text: 'nothing to see' }])
    expect(linkSegments('')).toEqual([])
  })
})

describe('isLinkable', () => {
  it('allows boxed items and not lines', () => {
    expect(isLinkable('note')).toBe(true)
    expect(isLinkable('frame')).toBe(true)
    expect(isLinkable('card')).toBe(true)
    // no box to hang a chip on
    expect(isLinkable('arrow')).toBe(false)
    expect(isLinkable('ink')).toBe(false)
  })
})

describe('describeLink', () => {
  const context = {
    activeWallId: 'main',
    wallName: (id: string) => ({ main: 'Wall', k3: 'Research' } as Record<string, string>)[id],
    itemLabel: (id: string) => (id === 'w-1' ? 'Login flow' : undefined),
    itemExists: (id: string) => id === 'w-1' || id === 'w-2'
  }

  it('names a web link by its host', () => {
    expect(describeLink('https://www.github.com/x', context)).toEqual({ label: 'github.com', missing: false, external: true })
  })

  it('names an item on this wall by its label, or its kind when it has none', () => {
    expect(describeLink('wall:main/w-1', context)).toEqual({ label: 'Login flow', missing: false, external: false })
    expect(describeLink('wall:main/w-2', context)).toEqual({ label: 'An item on this wall', missing: false, external: false })
  })

  it('says so when the item or wall is gone', () => {
    expect(describeLink('wall:main/w-9', context)).toEqual({ label: 'Deleted item', missing: true, external: false })
    expect(describeLink('wall:gone/w-1', context)).toEqual({ label: 'Deleted wall', missing: true, external: false })
  })

  it('names an item on another wall by that wall', () => {
    expect(describeLink('wall:k3/w-7', context)).toEqual({ label: 'Research', missing: false, external: false })
  })

  it('treats an unreadable link as missing', () => {
    expect(describeLink('javascript:alert(1)', context)).toEqual({ label: 'Broken link', missing: true, external: false })
  })
})

describe('remapItemLinks', () => {
  it('points item links at the copied walls and leaves the rest alone', () => {
    const doc = JSON.stringify({
      version: 1,
      items: [
        { id: 'a', kind: 'note', link: 'wall:k3/w-1' },
        { id: 'b', kind: 'note', link: 'wall:main/w-2' },
        { id: 'c', kind: 'note', link: 'https://example.com/' },
        { id: 'd', kind: 'note' }
      ]
    })
    const out = JSON.parse(remapItemLinks(doc, new Map([['k3', 'n7'], ['main', 'main']])))
    expect(out.items.map((i: { link?: string }) => i.link)).toEqual([
      'wall:n7/w-1', 'wall:main/w-2', 'https://example.com/', undefined
    ])
  })

  it('returns the stored value untouched when it isn\'t a readable doc', () => {
    expect(remapItemLinks('{not json', new Map())).toBe('{not json')
    expect(remapItemLinks('"just a string"', new Map())).toBe('"just a string"')
  })
})
