import { describe, it, expect } from 'vitest'
import { fuzzyScore, scoreCommand, rankCommands, type CommandLike } from '../src/shared/commandMatch'

const cmd = (label: string, group = 'Navigation', keywords?: string[]): CommandLike => ({
  id: label, label, group, keywords
})

describe('fuzzyScore', () => {
  it('matches a subsequence but not letters out of order', () => {
    expect(fuzzyScore('Go to Kanban', 'gok')).toBeGreaterThan(0)
    expect(fuzzyScore('Go to Kanban', 'kgo')).toBe(0)
  })

  it('rejects a character the text does not contain', () => {
    expect(fuzzyScore('Go to Kanban', 'gozz')).toBe(0)
  })

  it('treats an empty query as a match so the full list shows', () => {
    expect(fuzzyScore('anything', '')).toBe(1)
  })

  it('rewards word starts over letters buried mid-word', () => {
    // "gtk" is the initials of Go To Kanban; the same letters buried inside a
    // single word are a much weaker signal.
    expect(fuzzyScore('Go To Kanban', 'gtk')).toBeGreaterThan(fuzzyScore('gauntlet knack', 'gtk'))
  })

  it('rewards a prefix over a match starting later', () => {
    expect(fuzzyScore('Log', 'log')).toBeGreaterThan(fuzzyScore('Backlog', 'log'))
  })

  it('prefers a short label to a long one for the same match', () => {
    expect(fuzzyScore('Log', 'log')).toBeGreaterThan(fuzzyScore('Log something much longer', 'log'))
  })

  it('ignores spaces in the query so "go kan" still matches', () => {
    expect(fuzzyScore('Go to Kanban', 'go kan')).toBeGreaterThan(0)
  })

  it('is case-insensitive both ways', () => {
    expect(fuzzyScore('Go to Kanban', 'KANBAN')).toBeGreaterThan(0)
    expect(fuzzyScore('GO TO KANBAN', 'kanban')).toBeGreaterThan(0)
  })
})

describe('scoreCommand', () => {
  it('ranks a label match above a keyword match', () => {
    const byLabel = scoreCommand(cmd('Notes'), 'notes')
    const byKeyword = scoreCommand(cmd('Scratchpad', 'Navigation', ['notes']), 'notes')
    expect(byLabel).toBeGreaterThan(byKeyword)
  })

  it('finds a command through its group', () => {
    expect(scoreCommand(cmd('MCP Server', 'Settings'), 'settings')).toBeGreaterThan(0)
  })

  it('matches across group and label together', () => {
    // Neither field answers "settings mcp" alone.
    expect(scoreCommand(cmd('MCP Server', 'Settings'), 'settings mcp')).toBeGreaterThan(0)
  })

  it('returns a match for every command when the query is blank', () => {
    expect(scoreCommand(cmd('Anything'), '   ')).toBe(1)
  })
})

describe('rankCommands', () => {
  const list = [cmd('Go to Kanban'), cmd('Go to Log'), cmd('Go to Backlog'), cmd('Go to Notes')]

  it('keeps the authored order when there is no query', () => {
    expect(rankCommands(list, '').map(c => c.label)).toEqual(list.map(c => c.label))
  })

  it('drops non-matching commands', () => {
    const out = rankCommands(list, 'kanban')
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('Go to Kanban')
  })

  it('puts the most specific match first', () => {
    expect(rankCommands(list, 'log')[0].label).toBe('Go to Log')
  })

  it('honours the limit', () => {
    expect(rankCommands(list, '', 2)).toHaveLength(2)
  })

  it('breaks ties by authored order rather than reshuffling', () => {
    const tied = [cmd('Alpha thing'), cmd('Alpha thing')]
    tied[1].id = 'second'
    const out = rankCommands(tied, 'alpha')
    expect(out[0].id).toBe('Alpha thing')
    expect(out[1].id).toBe('second')
  })

  it('is stable across repeated identical queries', () => {
    const first = rankCommands(list, 'go').map(c => c.id)
    const second = rankCommands(list, 'go').map(c => c.id)
    expect(first).toEqual(second)
  })
})
