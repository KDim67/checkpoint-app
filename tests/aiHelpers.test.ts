import { describe, it, expect } from 'vitest'
import {
  classifyIntent,
  detectSkill,
  estimateTokens,
  getAIEntitiesFromMessage,
  parseThinkingAndContent,
  pruneHistory,
  wantsColumns
} from '../src/renderer/src/components/ai/aiHelpers'
import type { Message } from '../src/renderer/src/components/ai/types'

const msg = (content: string, role: Message['role'] = 'user'): Message => ({ role, content })

describe('parseThinkingAndContent', () => {
  it('splits a closed think block from the answer', () => {
    const { thinking, content } = parseThinkingAndContent('<think>weighing it up</think>The answer.')
    expect(thinking).toBe('weighing it up')
    expect(content).toBe('The answer.')
  })

  it('handles the alternative tag spellings', () => {
    expect(parseThinkingAndContent('<thinking>a</thinking>b').thinking).toBe('a')
    expect(parseThinkingAndContent('<thought>a</thought>b').thinking).toBe('a')
  })

  it('treats an unclosed block as still-streaming reasoning', () => {
    // the partial thought mustn't show as the answer
    const { thinking, content } = parseThinkingAndContent('Prefix <think>half a thou')
    expect(thinking).toBe('half a thou')
    expect(content).toBe('Prefix')
  })

  it('leaves text without any tag alone', () => {
    expect(parseThinkingAndContent('plain')).toEqual({ thinking: '', content: 'plain' })
  })
})

describe('estimateTokens', () => {
  it('counts latin text at roughly four characters a token', () => {
    expect(estimateTokens('a'.repeat(40))).toBe(10)
  })

  it('counts CJK far higher, which is the whole point of the split', () => {
    // 4 chars/token put Chinese at a quarter of its size
    const cjk = '你好世界'.repeat(10) // 40 codepoints
    expect(estimateTokens(cjk)).toBe(40)
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens('a'.repeat(40)))
  })

  it('is zero for nothing', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('pruneHistory', () => {
  it('keeps the newest turn even when it alone exceeds the budget', () => {
    const history = [msg('old'), msg('x'.repeat(4000))]
    const pruned = pruneHistory(history, 10)
    expect(pruned).toHaveLength(1)
    expect(pruned[0].content).toBe('x'.repeat(4000))
  })

  it('drops oldest first and preserves order', () => {
    const history = [msg('a'.repeat(400)), msg('b'.repeat(400)), msg('c'.repeat(400))]
    const pruned = pruneHistory(history, 200)
    expect(pruned.map(m => m.content[0])).toEqual(['b', 'c'])
  })

  it('keeps everything that fits', () => {
    const history = [msg('a'), msg('b'), msg('c')]
    expect(pruneHistory(history, 1000)).toHaveLength(3)
  })

  it('is empty for an empty history', () => {
    expect(pruneHistory([], 100)).toEqual([])
  })
})

describe('classifyIntent', () => {
  it('reads board structure changes as configure_board', () => {
    expect(classifyIntent('rename the Doing column to In Progress', null)).toBe('configure_board')
    expect(classifyIntent('set a WIP limit of 3', null)).toBe('configure_board')
    expect(classifyIntent('turn on swimlanes', null)).toBe('configure_board')
  })

  it('separates renaming a column from renaming a card', () => {
    // shared verbs, only the noun differs
    expect(classifyIntent('rename the column to Review', null)).toBe('configure_board')
    expect(classifyIntent('rename the card to Review', null)).toBe('update_items')
  })

  it('reads edits to existing cards as update_items, not creation', () => {
    expect(classifyIntent('move the login card to done', null)).toBe('update_items')
    expect(classifyIntent('mark it as complete', null)).toBe('update_items')
    expect(classifyIntent('bump the priority on that', null)).toBe('update_items')
  })

  it('requires both a verb and a noun before creating items', () => {
    expect(classifyIntent('create three cards for the auth work', null)).toBe('create_items')
    // a verb with no item noun is conversation
    expect(classifyIntent('create a summary of what we discussed', null)).toBe('converse')
  })

  it('treats a bare follow-up as more of the same', () => {
    expect(classifyIntent('more', null)).toBe('create_items')
    expect(classifyIntent('a few more', null)).toBe('create_items')
  })

  it('lets an active skill bias an otherwise ambiguous message', () => {
    expect(classifyIntent('write the opening scene', null)).toBe('converse')
    expect(classifyIntent('write the opening scene', 'narrative_specialist')).toBe('create_dialogue')
    expect(classifyIntent('how should I approach this', 'implementation_planner')).toBe('create_plan')
  })

  it('defaults to conversing when nothing matches', () => {
    expect(classifyIntent('what do you think?', null)).toBe('converse')
    expect(classifyIntent('', null)).toBe('converse')
  })
})

describe('detectSkill', () => {
  it('needs real signal, not a single passing word', () => {
    expect(detectSkill('a character')).toBeNull()
    expect(detectSkill('write the npc dialogue tree')).toBe('narrative_specialist')
  })

  it('picks the board skill for column talk', () => {
    expect(detectSkill('reorganise my kanban columns and swimlanes')).toBe('kanban_architect')
  })

  it('picks the planner for architecture talk', () => {
    expect(detectSkill('I need a step-by-step implementation plan')).toBe('implementation_planner')
  })

  it('returns nothing for empty input', () => {
    expect(detectSkill('')).toBeNull()
    expect(detectSkill('   ')).toBeNull()
  })
})

describe('wantsColumns', () => {
  it('spots requests for board structure', () => {
    expect(wantsColumns('give me some columns')).toBe(true)
    expect(wantsColumns('set up a board')).toBe(true)
  })

  it('ignores plain card requests', () => {
    expect(wantsColumns('add three cards')).toBe(false)
  })
})

describe('getAIEntitiesFromMessage', () => {
  it('pulls titles and column names out of a batch block', () => {
    const content = '```json\n{"cards":[{"title":"A"},{"title":"B"}],"columns":[{"name":"Doing"}]}\n```'
    expect(getAIEntitiesFromMessage(content)).toEqual({
      cardTitles: ['A', 'B'],
      columnNames: ['Doing']
    })
  })

  it('handles the single-card and single-column forms', () => {
    expect(getAIEntitiesFromMessage('```json\n{"title":"Solo"}\n```').cardTitles).toEqual(['Solo'])
    expect(getAIEntitiesFromMessage('```json\n{"name":"Review"}\n```').columnNames).toEqual(['Review'])
  })

  it('reads every block in one response', () => {
    const content = '```json\n{"title":"A"}\n```\ntext\n```json\n{"title":"B"}\n```'
    expect(getAIEntitiesFromMessage(content).cardTitles).toEqual(['A', 'B'])
  })

  it('skips malformed blocks instead of throwing', () => {
    const content = '```json\n{not json\n```\n```json\n{"title":"Good"}\n```'
    expect(getAIEntitiesFromMessage(content).cardTitles).toEqual(['Good'])
  })

  it('finds nothing in prose', () => {
    expect(getAIEntitiesFromMessage('just talking')).toEqual({ cardTitles: [], columnNames: [] })
  })
})
