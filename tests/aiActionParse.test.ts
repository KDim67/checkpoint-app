import { describe, it, expect } from 'vitest'
import {
  faultTolerantParseJSON,
  linkifyCardTitles,
  normalizeCardJson,
  normalizeColumnJson,
  parseBatchBoardJson,
  resolveColor
} from '../src/renderer/src/components/ai/aiActionParse'

describe('faultTolerantParseJSON', () => {
  it('parses valid JSON untouched', () => {
    expect(faultTolerantParseJSON('  {"a": [1, 2]}  ')).toEqual({ a: [1, 2] })
  })

  it('puts back the comma a model drops at a line break', () => {
    expect(faultTolerantParseJSON('{"a": 1\n"b": true\n"c": "x"}')).toEqual({ a: 1, b: true, c: 'x' })
  })

  it('joins objects written one per line without a comma', () => {
    expect(faultTolerantParseJSON('[{"a":1}\n{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('drops trailing commas', () => {
    expect(faultTolerantParseJSON('{"a": [1, 2,], }')).toEqual({ a: [1, 2] })
  })

  it('returns null for text that is not JSON at all', () => {
    expect(faultTolerantParseJSON('Sure! Here is your board.')).toBeNull()
  })
})

describe('resolveColor', () => {
  it('turns a colour name into its hex, whatever the case', () => {
    expect(resolveColor(' Green ')).toBe('#22c55e')
  })

  it('passes hex and rgb through', () => {
    expect(resolveColor('#123456')).toBe('#123456')
    expect(resolveColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
  })

  it('falls back to blue for anything it does not know', () => {
    expect(resolveColor('mauve')).toBe('#3b82f6')
    expect(resolveColor(7)).toBe('#3b82f6')
    expect(resolveColor(undefined)).toBe('#3b82f6')
  })
})

describe('normalizeCardJson', () => {
  it('unwraps a wrapper key and coerces what a small model gets wrong', () => {
    expect(normalizeCardJson('{"create_card": {"title": " Ship it ", "priority": "3", "description": "d"}}')).toEqual({
      title: 'Ship it',
      body: 'd',
      status: 'open',
      priority: 3,
      tags: []
    })
  })

  it('rejects a block that is only a column', () => {
    expect(normalizeCardJson('{"name": "Backlog", "wipLimit": 5}')).toBeNull()
  })

  it('accepts name as the title only alongside card fields', () => {
    expect(normalizeCardJson('{"name": "Fix login", "description": "x"}')?.title).toBe('Fix login')
    expect(normalizeCardJson('{"name": "Fix login"}')).toBeNull()
  })

  it('falls back to the default priority for one the database would refuse', () => {
    expect(normalizeCardJson('{"title": "T", "priority": 9}')?.priority).toBe(2)
  })
})

describe('normalizeColumnJson', () => {
  it('reads the snake_case spellings and a WIP limit written as a string', () => {
    expect(normalizeColumnJson('{"column_name": "Doing", "wip_limit": "5", "color": "Green"}')).toEqual({
      name: 'Doing',
      wipLimit: 5,
      colorMode: 'header',
      color: '#22c55e'
    })
  })

  it('rejects a block that is only a card', () => {
    expect(normalizeColumnJson('{"title": "Write docs", "status": "open"}')).toBeNull()
  })

  it('treats an unreadable WIP limit as no limit', () => {
    expect(normalizeColumnJson('{"create_column": {"name": "Q", "wipLimit": "lots"}}')?.wipLimit).toBeNull()
  })
})

describe('parseBatchBoardJson', () => {
  it('reads columns and cards, dropping repeats regardless of case', () => {
    const board = parseBatchBoardJson(
      '{"columns": [{"name": "To Do"}, {"name": "to do"}], "cards": [{"title": "A", "status": "To Do"}, {"title": "a"}]}'
    )
    expect(board?.columns.map(c => c.name)).toEqual(['To Do'])
    expect(board?.cards.map(c => [c.title, c.status])).toEqual([['A', 'To Do']])
  })

  it('reads a colour the model wrote into colorMode', () => {
    expect(parseBatchBoardJson('{"columns": [{"name": "X", "colorMode": "red"}]}')?.columns[0].color).toBe('#ef4444')
  })

  it('reads stages and tasks as columns and cards', () => {
    const board = parseBatchBoardJson('{"stages": [{"name": "S"}], "tasks": [{"title": "T"}]}')
    expect(board?.columns.map(c => c.name)).toEqual(['S'])
    expect(board?.cards.map(c => c.title)).toEqual(['T'])
  })

  it('sorts a bare array of mixed objects into columns and cards', () => {
    const board = parseBatchBoardJson('[{"name": "Backlog", "wipLimit": 3}, {"title": "Card"}]')
    expect(board?.columns.map(c => c.name)).toEqual(['Backlog'])
    expect(board?.cards.map(c => c.title)).toEqual(['Card'])
  })

  it('files a nested card under the column it was written inside', () => {
    const board = parseBatchBoardJson('{"board": {"create_column": {"name": "Review"}, "create_card": {"title": "Check PR"}}}')
    expect(board?.columns.map(c => c.name)).toEqual(['Review'])
    expect(board?.cards.map(c => [c.title, c.status])).toEqual([['Check PR', 'Review']])
  })

  it('returns null when there is nothing board-shaped in it', () => {
    expect(parseBatchBoardJson('{"foo": 1}')).toBeNull()
    expect(parseBatchBoardJson('no json here')).toBeNull()
  })
})

describe('linkifyCardTitles', () => {
  const entries = [{ title: 'Login page', id: 'c1' }]

  it('links a title mentioned in prose, keeping how it was written', () => {
    expect(linkifyCardTitles('Fix the login page today', entries)).toBe('Fix the [login page](#card:c1) today')
  })

  it('leaves code spans and fenced blocks alone', () => {
    expect(linkifyCardTitles('`Login page`', entries)).toBe('`Login page`')
    expect(linkifyCardTitles('```\nLogin page\n```', entries)).toBe('```\nLogin page\n```')
  })

  it('does not link inside a longer word or an existing link', () => {
    expect(linkifyCardTitles('Login pages', entries)).toBe('Login pages')
    expect(linkifyCardTitles('[Login page](#card:c1)', entries)).toBe('[Login page](#card:c1)')
  })

  it('returns the text as it was when there are no titles to find', () => {
    expect(linkifyCardTitles('Login page', [])).toBe('Login page')
  })
})
