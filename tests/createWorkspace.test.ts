import { describe, it, expect } from 'vitest'
import {
  availableWorkspaceSlug,
  ensureWorkspaceListed,
  markWorkspaceShared,
  setWorkspaceShared,
  slugifyWorkspace,
  WORKSPACE_COLORS,
  type WorkspaceEntry
} from '../src/renderer/src/lib/createWorkspace'

describe('slugifyWorkspace', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyWorkspace('My Unity Project')).toBe('my-unity-project')
  })

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugifyWorkspace('Game -- Jam!!  2026')).toBe('game-jam-2026')
  })

  it('trims hyphens from both ends', () => {
    expect(slugifyWorkspace('  ...Client Work...  ')).toBe('client-work')
  })

  it('returns empty for a name with nothing usable in it', () => {
    // The caller treats this as a validation failure rather than creating a
    // workspace whose slug is the empty string.
    expect(slugifyWorkspace('!!!')).toBe('')
    expect(slugifyWorkspace('   ')).toBe('')
  })

  it('keeps digits', () => {
    expect(slugifyWorkspace('Sprint 42')).toBe('sprint-42')
  })

  it('is idempotent, so re-slugging an existing slug is safe', () => {
    const once = slugifyWorkspace('My Project')
    expect(slugifyWorkspace(once)).toBe(once)
  })
})

// The picker reads this list. A shared board that never reaches it opens once
// and is then unreachable.
describe('ensureWorkspaceListed', () => {
  const entry = (slug: string, over: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
    slug, name: slug, color: '#000000', ...over
  })

  it('adds a workspace the list has never seen', () => {
    const next = ensureWorkspaceListed([], 'test2-shared', 'Test2 Shared')
    expect(next.map(w => w.slug)).toEqual(['test2-shared'])
    expect(next[0].name).toBe('Test2 Shared')
  })

  it('falls back to the slug when the host sent no name', () => {
    expect(ensureWorkspaceListed([], 'domimorfi')[0].name).toBe('domimorfi')
  })

  it('gives it a colour from the same palette as every other workspace', () => {
    const next = ensureWorkspaceListed([entry('a'), entry('b')], 'c')
    expect(WORKSPACE_COLORS).toContain(next[2].color)
  })

  it('hands back the very same list when the workspace is already there', () => {
    // Identity, not equality: the caller skips the write on it.
    const list = [entry('domimorfi')]
    expect(ensureWorkspaceListed(list, 'domimorfi')).toBe(list)
  })

  it('never overwrites what is already recorded for that workspace', () => {
    // Rejoining is not a rename.
    const list = [entry('domimorfi', { name: 'Domimorfi', color: '#cdf12b' })]
    const next = ensureWorkspaceListed(list, 'domimorfi', 'Something Else')
    expect(next[0].name).toBe('Domimorfi')
    expect(next[0].color).toBe('#cdf12b')
  })

  it('leaves the workspaces that were already there alone', () => {
    const list = [entry('one'), entry('two')]
    const next = ensureWorkspaceListed(list, 'three')
    expect(next.slice(0, 2)).toEqual(list)
    expect(next).toHaveLength(3)
  })
})

// Joining a shared board used to overwrite whatever was already under that
// name. Keeping both needs somewhere to put the second copy, and the name has
// to be predictable enough to show in the prompt before it is made.
describe('availableWorkspaceSlug', () => {
  it('gives back the name itself when nothing is using it', () => {
    expect(availableWorkspaceSlug('domimorfi', [])).toBe('domimorfi')
    expect(availableWorkspaceSlug('domimorfi', ['other'])).toBe('domimorfi')
  })

  it('suffixes the first clash rather than numbering it', () => {
    expect(availableWorkspaceSlug('domimorfi', ['domimorfi'])).toBe('domimorfi-shared')
  })

  it('numbers from two once the suffixed name is taken as well', () => {
    expect(availableWorkspaceSlug('domimorfi', ['domimorfi', 'domimorfi-shared']))
      .toBe('domimorfi-shared-2')
  })

  it('keeps counting rather than landing back on an earlier copy', () => {
    const taken = ['domimorfi', 'domimorfi-shared', 'domimorfi-shared-2', 'domimorfi-shared-3']
    expect(availableWorkspaceSlug('domimorfi', taken)).toBe('domimorfi-shared-4')
  })

  it('never returns a name that is taken, which would be a wipe', () => {
    // The set is everything it could reasonably produce.
    const taken = new Set(['x', 'x-shared', ...Array.from({ length: 998 }, (_, i) => `x-shared-${i + 2}`)])
    expect(taken.has(availableWorkspaceSlug('x', taken))).toBe(false)
  })

  it('accepts a set as readily as an array', () => {
    expect(availableWorkspaceSlug('domimorfi', new Set(['domimorfi']))).toBe('domimorfi-shared')
  })
})

// A workspace holding someone else's board looked exactly like one of your own.
describe('setWorkspaceShared / markWorkspaceShared', () => {
  const entry = (slug: string, over: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
    slug, name: slug, color: '#000000', ...over
  })

  it('labels a workspace that is already listed', () => {
    const next = setWorkspaceShared([entry('domimorfi')], 'domimorfi', true)
    expect(next[0].shared).toBe(true)
  })

  it('leaves the other workspaces alone', () => {
    const list = [entry('one'), entry('two')]
    const next = setWorkspaceShared(list, 'two', true)
    expect(next[0]).toBe(list[0])
    expect(next[1].shared).toBe(true)
  })

  it('removes the key rather than storing false', () => {
    // An unshared workspace should serialise the way it did before the flag.
    const next = setWorkspaceShared([entry('domimorfi', { shared: true })], 'domimorfi', false)
    expect('shared' in next[0]).toBe(false)
  })

  it('hands back the same list when it already says that', () => {
    // Identity, because the caller skips the write on it.
    const shared = [entry('domimorfi', { shared: true })]
    expect(setWorkspaceShared(shared, 'domimorfi', true)).toBe(shared)
    const plain = [entry('domimorfi')]
    expect(setWorkspaceShared(plain, 'domimorfi', false)).toBe(plain)
  })

  it('ignores a workspace that is not in the list', () => {
    const list = [entry('one')]
    expect(setWorkspaceShared(list, 'missing', true)).toBe(list)
  })

  it('adds and labels a workspace joined for the first time', () => {
    const next = markWorkspaceShared([], 'domimorfi', 'Domimorfi')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ slug: 'domimorfi', name: 'Domimorfi', shared: true })
  })

  it('labels a board being rejoined, which ensureWorkspaceListed will not touch', () => {
    const list = [entry('domimorfi', { name: 'Domimorfi' })]
    const next = markWorkspaceShared(list, 'domimorfi')
    expect(next[0].shared).toBe(true)
    // Rejoining is still not a rename.
    expect(next[0].name).toBe('Domimorfi')
  })

  it('is idempotent, so rejoining repeatedly writes nothing', () => {
    const list = [entry('domimorfi', { shared: true })]
    expect(markWorkspaceShared(list, 'domimorfi')).toBe(list)
  })
})
