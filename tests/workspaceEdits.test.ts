import { describe, expect, it } from 'vitest'
import { hidden, matching, movedBy, movedTo, nextColor, replaced, restored } from '../src/renderer/src/lib/workspaceEdits'
import { WORKSPACE_COLORS, type WorkspaceEntry } from '../src/renderer/src/lib/createWorkspace'

// the workspace list's edits: order, hiding with undo, filtering

const entry = (slug: string, name = slug): WorkspaceEntry => ({ slug, name, color: '#10b981' })
const LIST = [entry('work', 'Work'), entry('client-site', 'Client site'), entry('thesis', 'Thesis')]
const slugs = (list: WorkspaceEntry[]): string[] => list.map(e => e.slug)

describe('moving a workspace', () => {
  it('goes one place up or down, and stays put at either end without a new list', () => {
    expect(slugs(movedBy(LIST, 'thesis', -1))).toEqual(['work', 'thesis', 'client-site'])
    expect(slugs(movedBy(LIST, 'work', 1))).toEqual(['client-site', 'work', 'thesis'])
    expect(movedBy(LIST, 'work', -1)).toBe(LIST)
    expect(movedBy(LIST, 'thesis', 1)).toBe(LIST)
    expect(movedBy(LIST, 'missing', 1)).toBe(LIST)
  })

  it('drops where a drag puts it', () => {
    expect(slugs(movedTo(LIST, 0, 2))).toEqual(['client-site', 'thesis', 'work'])
    expect(slugs(movedTo(LIST, 2, 0))).toEqual(['thesis', 'work', 'client-site'])
    expect(movedTo(LIST, 1, 1)).toBe(LIST)
    expect(movedTo(LIST, 0, 9)).toBe(LIST)
  })
})

describe('hiding a workspace', () => {
  it('takes it out and remembers where, so Undo puts it back in the same place', () => {
    const { list, index } = hidden(LIST, 'client-site')
    expect(slugs(list)).toEqual(['work', 'thesis'])
    expect(slugs(restored(list, LIST[1], index))).toEqual(slugs(LIST))
  })

  it('never brings back a second copy, and puts one back at the end when the list got shorter', () => {
    expect(restored(LIST, LIST[0], 0)).toBe(LIST)
    expect(slugs(restored([entry('work')], entry('thesis'), 5))).toEqual(['work', 'thesis'])
  })
})

describe('editing and listing', () => {
  it('replaces one entry, a new slug included', () => {
    expect(slugs(replaced(LIST, 'thesis', entry('phd', 'PhD')))).toEqual(['work', 'client-site', 'phd'])
  })

  it('goes round the colours in order', () => {
    expect(nextColor([])).toBe(WORKSPACE_COLORS[0])
    expect(nextColor(LIST)).toBe(WORKSPACE_COLORS[3])
    expect(nextColor(Array.from({ length: WORKSPACE_COLORS.length }, (_, i) => entry(`w${i}`)))).toBe(WORKSPACE_COLORS[0])
  })

  it('finds by name or slug in any case, and shows everything for an empty filter', () => {
    expect(slugs(matching(LIST, '  CLIENT '))).toEqual(['client-site'])
    expect(slugs(matching(LIST, 'client-s'))).toEqual(['client-site'])
    expect(slugs(matching(LIST, 'is'))).toEqual(['thesis'])
    expect(matching(LIST, '   ')).toBe(LIST)
  })
})
