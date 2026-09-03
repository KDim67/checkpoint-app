import { describe, it, expect } from 'vitest'
import {
  buildBasePrompt,
  buildBoardState,
  buildDateBlock,
  buildEnforcement,
  buildMemoryBlock,
  buildReasoningInstruction,
  buildStructuredInstruction,
  buildWorkspaceIndex,
  historyBudgetFor,
  resolveSkillId,
  structuredKindFor,
  waitingLabelFor
} from '../src/renderer/src/components/ai/promptAssembly'
import type { ColumnConfig } from '../src/shared/boardModel'
import type { Item } from '../src/shared/types'

const col = (id: string, name: string): ColumnConfig => ({ id, name, wipLimit: null })

const card = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  type: 'card',
  context: 'work',
  title: 'A card',
  body: '',
  status: 'open',
  priority: 2,
  position: 1000,
  created_at: 0,
  updated_at: 0,
  due_at: null,
  metadata: '{}',
  ...over
})

describe('buildBasePrompt', () => {
  it('gives small models the terse form', () => {
    const terse = buildBasePrompt(true)
    const full = buildBasePrompt(false)
    expect(terse.length).toBeLessThan(full.length)
  })

  it('tells both forms they write directly to the board', () => {
    for (const p of [buildBasePrompt(true), buildBasePrompt(false)]) {
      expect(p.toLowerCase()).toContain('board')
      expect(p).toMatch(/automatically|DIRECT WRITE ACCESS/)
    }
  })

  it('keeps the full form warning against naming rival tools', () => {
    // Mentioning Trello or Jira makes the assistant sound like it is describing
    // somewhere else to go, in an app that is the destination.
    expect(buildBasePrompt(false)).toContain('Trello')
  })
})

describe('buildDateBlock', () => {
  it('pins the ISO date so relative dates can be resolved', () => {
    const block = buildDateBlock(new Date('2026-06-15T09:30:00Z'))
    expect(block).toContain('2026-06-15')
    expect(block).toContain('CURRENT DATE & TIME')
  })
})

describe('buildBoardState', () => {
  const cols = [col('open', 'Backlog'), col('done', 'Done')]

  it('lists every column id the model is allowed to use', () => {
    const text = buildBoardState('work', cols, [], [])
    expect(text).toContain('"open"')
    expect(text).toContain('"done"')
    expect(text).toContain('VALID COLUMN IDs')
  })

  it('places cards under the column their status names', () => {
    const cards = [card({ title: 'Ship it', status: 'done' })]
    const text = buildBoardState('work', cols, cards, cards)
    const doneIdx = text.indexOf('Column "Done"')
    const backlogIdx = text.indexOf('Column "Backlog"')
    expect(text.indexOf('Ship it')).toBeGreaterThan(doneIdx)
    expect(doneIdx).toBeGreaterThan(backlogIdx)
  })

  it('matches a status that names the column rather than its id', () => {
    // Cards created before ids settled carry the display name as their status.
    const cards = [card({ title: 'Legacy', status: 'Done' })]
    const text = buildBoardState('work', cols, cards, cards)
    expect(text.slice(text.indexOf('Column "Done"'))).toContain('Legacy')
  })

  it('marks an empty column rather than leaving it blank', () => {
    expect(buildBoardState('work', cols, [], [])).toContain('(empty)')
  })

  it('lists forbidden titles so duplicates can be refused', () => {
    const cards = [card({ title: 'Do not repeat me' })]
    const text = buildBoardState('work', cols, cards, cards)
    expect(text).toContain('FORBIDDEN DUPLICATE TITLES')
    expect(text).toContain('Do not repeat me')
  })

  it('says so explicitly when there is nothing to forbid', () => {
    expect(buildBoardState('work', cols, [], [])).toContain('(none yet)')
  })

  it('shows a due date in the ISO form the model is told to expect', () => {
    const cards = [card({ title: 'Due soon', due_at: Date.UTC(2026, 5, 15) })]
    expect(buildBoardState('work', cols, cards, cards)).toContain('(Due: 2026-06-15)')
  })
})

describe('buildMemoryBlock', () => {
  it('tags each memory with its category, upper-cased', () => {
    const text = buildMemoryBlock([{ category: 'semantic', memory_key: 'engine', content: 'Unity 6' }])
    expect(text).toContain('[SEMANTIC] engine: Unity 6')
  })
})

describe('buildWorkspaceIndex', () => {
  const files = [
    { name: 'a.ts', relativePath: 'src/a.ts', extension: '.ts', size: 1 },
    { name: 'b.ts', relativePath: 'src/b.ts', extension: '.ts', size: 1 },
    { name: 'c.md', relativePath: 'docs/c.md', extension: '.md', size: 1 },
    { name: 'r.json', relativePath: 'root.json', extension: '.json', size: 1 }
  ]

  it('groups by top-level folder', () => {
    const text = buildWorkspaceIndex('C:/proj', files, 100)
    expect(text).toContain('src/')
    expect(text).toContain('docs/')
  })

  it('files a root-level file under (root) rather than dropping it', () => {
    expect(buildWorkspaceIndex('C:/proj', files, 100)).toContain('(root)')
  })

  it('counts extensions per folder', () => {
    expect(buildWorkspaceIndex('C:/proj', files, 100)).toContain('.ts\u00d72')
  })

  it('caps the listing for the model tier but still reports the real total', () => {
    const text = buildWorkspaceIndex('C:/proj', files, 1)
    expect(text).not.toContain('docs/')
    // The count is of everything indexed, not of what fitted, otherwise the
    // model is told the project is smaller than it is.
    expect(text).toContain('Total files: 4')
  })
})

describe('resolveSkillId', () => {
  it('lets a pinned skill win over anything inferred', () => {
    expect(resolveSkillId('kanban_architect', 'write the npc dialogue', 'create_dialogue'))
      .toBe('kanban_architect')
  })

  it('recalls a skill from the wording when none is pinned', () => {
    expect(resolveSkillId(null, 'write the npc dialogue tree', 'converse'))
      .toBe('narrative_specialist')
  })

  it('falls back to the intent when the wording says nothing', () => {
    expect(resolveSkillId(null, 'do it', 'create_plan')).toBe('implementation_planner')
    expect(resolveSkillId(null, 'do it', 'create_dialogue')).toBe('narrative_specialist')
  })

  it('returns nothing for ordinary conversation', () => {
    expect(resolveSkillId(null, 'hello', 'converse')).toBeNull()
  })
})

describe('structuredKindFor', () => {
  it('maps every creating intent to a generator', () => {
    expect(structuredKindFor('create_items')).toBe('board')
    expect(structuredKindFor('create_plan')).toBe('plan')
    expect(structuredKindFor('create_dialogue')).toBe('dialogue')
    expect(structuredKindFor('update_items')).toBe('update')
    expect(structuredKindFor('configure_board')).toBe('config')
  })

  it('leaves conversation to the streaming path', () => {
    expect(structuredKindFor('converse')).toBeNull()
  })
})

describe('waitingLabelFor', () => {
  it('says something specific for every kind', () => {
    const kinds = ['board', 'plan', 'dialogue', 'update', 'config'] as const
    const labels = kinds.map(waitingLabelFor)
    expect(new Set(labels).size).toBe(kinds.length)
    for (const l of labels) expect(l.length).toBeGreaterThan(0)
  })
})

describe('buildStructuredInstruction', () => {
  it('asks for a column pipeline only when structure was requested', () => {
    expect(buildStructuredInstruction('board', true)).toContain('BOARD STRUCTURE')
    expect(buildStructuredInstruction('board', false)).toContain('Reuse existing columns')
  })

  it('tells the update generator that target is a card title, never a column', () => {
    // The single most common structured-output mistake.
    const text = buildStructuredInstruction('update', false)
    expect(text).toContain('NEVER a column name')
    expect(text).toContain('toColumn')
  })

  it('requires dialogue targets to resolve to a real node', () => {
    expect(buildStructuredInstruction('dialogue', false)).toContain('exact node id')
  })
})

describe('historyBudgetFor', () => {
  it('leaves room for the system prompt and the response', () => {
    expect(historyBudgetFor(32000, null, null, [], 100)).toBeLessThan(32000 - 2000)
  })

  it('shrinks once a skill and a workspace are paid for', () => {
    const bare = historyBudgetFor(32000, null, null, [], 100)
    const loaded = historyBudgetFor(
      32000,
      'kanban_architect',
      'C:/proj',
      [{ name: 'a.ts', relativePath: 'src/a.ts', extension: '.ts', size: 1 }],
      100
    )
    expect(loaded).toBeLessThan(bare)
  })
})

describe('buildReasoningInstruction', () => {
  it('asks a native reasoning model for think tags', () => {
    expect(buildReasoningInstruction('deepseek-r1:7b', false)).toContain('<think>')
    expect(buildReasoningInstruction('qwq:32b', false)).toContain('<think>')
  })

  it('keeps it short for a small model', () => {
    const small = buildReasoningInstruction('llama3.2:1b', true)
    const large = buildReasoningInstruction('llama3.3:70b', false)
    expect(small).not.toContain('<think>')
    expect(small.length).toBeLessThan(large.length)
  })
})

describe('buildEnforcement', () => {
  it('forbids JSON for plain conversation', () => {
    const text = buildEnforcement('converse')
    expect(text).toContain('DO NOT OUTPUT JSON')
  })

  it('names the right block for each creating intent', () => {
    expect(buildEnforcement('create_dialogue')).toContain('create_dialogue_tree')
    expect(buildEnforcement('create_plan')).toContain('create_plan')
    expect(buildEnforcement('update_items')).toContain('update_board')
    expect(buildEnforcement('configure_board')).toContain('configure_board')
  })

  it('lists every configure_board operation the MCP schema accepts', () => {
    // These two lists have to agree; a model told about six of seven ops simply
    // never uses the seventh.
    const text = buildEnforcement('configure_board')
    for (const op of [
      'add_column', 'update_column', 'delete_column', 'reorder_columns',
      'set_background', 'set_swimlanes', 'set_card_display'
    ]) {
      expect(text, op).toContain(op)
    }
  })

  it('lists every update_board operation', () => {
    const text = buildEnforcement('update_items')
    for (const op of ['move', 'set_priority', 'retitle', 'update_body', 'archive']) {
      expect(text, op).toContain(op)
    }
  })

  it('reminds the creating path about ids and duplicates', () => {
    const text = buildEnforcement('create_items')
    expect(text).toContain('VALID COLUMN IDs')
    expect(text).toContain('FORBIDDEN DUPLICATE TITLES')
  })
})
