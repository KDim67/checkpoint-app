import { describe, expect, it } from 'vitest'
import {
  buildKanbanJsonExport,
  parseKanbanJsonExport,
  normalizePriority
} from '../src/shared/kanbanExport'
import { normalizeBoardConfig, type BoardConfig } from '../src/shared/boardModel'
import type { Item } from '../src/shared/types'

describe('kanbanExport', () => {
  const sampleConfig: BoardConfig = normalizeBoardConfig({
    columns: [
      { id: 'todo', name: 'To Do', color: '#6366f1', wipLimit: null },
      { id: 'done', name: 'Done', color: '#10b981', wipLimit: null }
    ]
  })

  const sampleCards: Item[] = [
    {
      id: 'c1',
      type: 'card',
      context: 'project-a',
      title: 'First Card',
      body: 'Card description markdown',
      status: 'todo',
      priority: 2,
      position: 1000,
      created_at: 100000,
      updated_at: 100000,
      due_at: 1750000000000,
      metadata: JSON.stringify({ checklist: [{ id: 'sub-1', text: 'Step 1', done: false }] }),
      tags: [{ id: 't1', name: 'UI', color: '#3b82f6' }]
    },
    {
      id: 'c2',
      type: 'card',
      context: 'project-a',
      title: 'Archived Card',
      body: 'Should be ignored on export',
      status: 'archived',
      priority: 1,
      position: 2000,
      created_at: 100000,
      updated_at: 100000,
      due_at: null,
      metadata: '{}'
    }
  ]

  it('buildKanbanJsonExport packages board config and active cards into structured JSON', () => {
    const exported = buildKanbanJsonExport(sampleConfig, sampleCards, 'project-a')

    expect(exported.checkpointType).toBe('kanban')
    expect(exported.version).toBe(1)
    expect(exported.workspace).toBe('project-a')
    expect(typeof exported.exportedAt).toBe('string')
    expect(exported.board.config?.columns).toHaveLength(2)

    // Only active cards, archived filtered out
    expect(exported.board.cards).toHaveLength(1)
    const card = exported.board.cards[0]
    expect(card.title).toBe('First Card')
    expect(card.body).toBe('Card description markdown')
    expect(card.status).toBe('todo')
    expect(card.priority).toBe(2)
    expect(card.tags).toEqual([{ name: 'UI', color: '#3b82f6' }])
    expect(card.metadata).toContain('Step 1')
  })

  it('parseKanbanJsonExport reads exported json string or object', () => {
    const exported = buildKanbanJsonExport(sampleConfig, sampleCards, 'project-a')
    const jsonStr = JSON.stringify(exported)

    const parsed = parseKanbanJsonExport(jsonStr)
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.workspace).toBe('project-a')
    expect(parsed.config?.columns).toHaveLength(2)
    expect(parsed.cards).toHaveLength(1)
    expect(parsed.cards[0].title).toBe('First Card')
    expect(parsed.cards[0].tags).toEqual([{ name: 'UI', color: '#3b82f6' }])
  })

  it('parseKanbanJsonExport gracefully handles arbitrary or bare card arrays', () => {
    const bare = {
      cards: [
        { title: 'Bare Task', status: 'backlog', priority: 'high' }
      ]
    }
    const parsed = parseKanbanJsonExport(bare)
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.cards).toHaveLength(1)
    expect(parsed.cards[0].title).toBe('Bare Task')
    expect(parsed.cards[0].priority).toBe(3)
  })

  it('normalizePriority maps both numbers and priority name strings', () => {
    expect(normalizePriority(0)).toBe(0)
    expect(normalizePriority(1)).toBe(1)
    expect(normalizePriority(2)).toBe(2)
    expect(normalizePriority(3)).toBe(3)
    expect(normalizePriority('urgent')).toBe(3)
    expect(normalizePriority('high')).toBe(3)
    expect(normalizePriority('medium')).toBe(2)
    expect(normalizePriority('low')).toBe(1)
    expect(normalizePriority('unknown')).toBe(0)
  })
})
