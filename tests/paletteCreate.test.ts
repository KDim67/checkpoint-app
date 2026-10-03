import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/data/settings', () => ({ setSetting: vi.fn(async () => {}) }))

import { buildCommands, type CommandContext } from '../src/renderer/src/lib/commands'
import { wallIdOf, wallLink, wallSearchHits } from '../src/shared/wallSearch'
import type { WallItem } from '../src/shared/wallModel'

const context = (over: Partial<CommandContext> = {}): CommandContext => ({
  setView: vi.fn(),
  setWorkspace: vi.fn(),
  setSettingsTab: vi.fn(),
  setRightPanelContent: vi.fn(),
  toggleRightPanel: vi.fn(),
  workspaces: ['default'],
  activeWorkspace: 'default',
  enabledViews: {},
  aiEnabled: false,
  savedViews: [],
  applyView: vi.fn(),
  create: vi.fn(),
  ...over
})

describe('making things from the palette', () => {
  it('offers a new card, task, note, sticky and wall, each handed to its view', () => {
    const ctx = context()
    const made = buildCommands(ctx).filter(c => c.group === 'Create')

    expect(made.map(c => c.label)).toStrictEqual(['New card', 'New task', 'New note', 'New sticky note', 'New wall'])
    made.find(c => c.label === 'New wall')?.run()
    expect(ctx.create).toHaveBeenCalledWith('wall')
  })

  it('leaves out what belongs to a view that is switched off', () => {
    const labels = buildCommands(context({ enabledViews: { wall: false } })).map(c => c.label)
    expect(labels).not.toContain('New sticky note')
    expect(labels).not.toContain('New wall')
    expect(labels).toContain('New card')
  })
})

describe('walls in the search', () => {
  const sticky = (id: string, text: string): WallItem => ({ id, kind: 'note', x: 0, y: 0, width: 100, height: 100, z: 0, text })
  const walls = [
    { ref: { id: 'w1', name: 'Launch plan' }, items: [sticky('a', 'Book the venue'), sticky('b', 'Order the cake')] },
    { ref: { id: 'w2', name: 'Ideas' }, items: [sticky('c', 'Venue with a garden')] }
  ]

  it('finds a wall by its name, and opens it where it was left', () => {
    const hits = wallSearchHits(walls, 'launch')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'wall', title: 'Launch plan', target: 'wall:w1' })
    expect(wallIdOf(hits[0].target as string)).toBe('w1')
  })

  it('finds what is written on any wall, and says which wall it is on', () => {
    const hits = wallSearchHits(walls, 'venue')
    expect(hits.map(h => [h.title, h.subtitle, h.target])).toStrictEqual([
      ['Book the venue', 'On Launch plan', 'wall:w1/a'],
      ['Venue with a garden', 'On Ideas', 'wall:w2/c']
    ])
  })

  it('tells a wall link from an item link', () => {
    expect(wallIdOf(wallLink('w9'))).toBe('w9')
    expect(wallIdOf('wall:w9/item')).toBeNull()
  })
})
