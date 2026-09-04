import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  collectLabels,
  describeImport,
  parseForeignBoard
} from '../src/shared/foreignImport'

/**
 * The unit tests use hand-made objects; this one runs a whole realistic export
 * through, of the shape and size someone actually migrating would bring.
 *
 * The fixture deliberately contains every awkward case at once: lists out of
 * array order, an archived list, an archived card, a card orphaned by that
 * archived list, cards with no labels, a card with two labels, checklists in
 * mixed order, a null due date and a real one.
 */
const board = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'trello-board.json'), 'utf8')
)

describe('a whole Trello export', () => {
  const parsed = parseForeignBoard(board)!

  it('is recognised', () => {
    expect(parsed).not.toBeNull()
    expect(parsed.source).toBe('trello')
    expect(parsed.name).toBe('Roguelike Prototype')
  })

  it('puts the columns in the order Trello showed them', () => {
    // The fixture lists Done first in the array and last by position.
    expect(parsed.columns.map(c => c.name)).toEqual([
      'To Do', 'In Progress', 'Playtesting', 'Done'
    ])
  })

  it('leaves the archived list out but says so', () => {
    expect(parsed.columns.map(c => c.name)).not.toContain('Old Ideas (archived)')
    expect(parsed.notes.some(n => n.includes('archived list'))).toBe(true)
  })

  it('keeps every card, including the archived and the orphaned one', () => {
    // Ten cards in, ten cards out. Nothing silently lost in migration.
    expect(parsed.cards).toHaveLength(10)
  })

  it('archives the card that was archived', () => {
    const abandoned = parsed.cards.find(c => c.title.startsWith('Abandoned'))!
    expect(abandoned.status).toBe('archived')
  })

  it('rescues the card whose list was archived into the first column', () => {
    const orphan = parsed.cards.find(c => c.title.startsWith('Isometric'))!
    expect(orphan.status).toBe('to_do')
    expect(parsed.notes.some(n => n.includes('"To Do"'))).toBe(true)
  })

  it('carries due dates across and leaves the others null', () => {
    const dungeon = parsed.cards.find(c => c.title.startsWith('Procedural'))!
    expect(dungeon.due_at).toBe(Date.parse('2026-10-15T17:00:00.000Z'))
    expect(parsed.cards.find(c => c.title.startsWith('Enemy AI'))!.due_at).toBeNull()
  })

  it('carries checklists with their done state', () => {
    const dungeon = parsed.cards.find(c => c.title.startsWith('Procedural'))!
    expect(dungeon.checklist).toEqual([
      { text: 'BSP split', done: true },
      { text: 'Carve corridors', done: true },
      { text: 'Place stairs', done: false },
      { text: 'Seed from a string', done: false }
    ])
  })

  it('turns labels into tags, keeping Trello colours', () => {
    expect(collectLabels(parsed)).toEqual(
      expect.arrayContaining([
        { name: 'code', color: '#0079bf' },
        { name: 'art', color: '#c377e0' },
        { name: 'bug', color: '#eb5a46' },
        { name: 'design', color: '#61bd4f' }
      ])
    )
  })

  it('keeps both labels on the card that has two', () => {
    const torches = parsed.cards.find(c => c.title.startsWith('Torches'))!
    expect(torches.labels.map(l => l.name).sort()).toEqual(['bug', 'code'])
  })

  it('spaces positions per column so the order survives', () => {
    const todo = parsed.cards.filter(c => c.status === 'to_do')
    const positions = todo.map(c => c.position)
    expect(new Set(positions).size).toBe(positions.length)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('summarises what the user is about to create', () => {
    expect(describeImport(parsed)).toBe('4 columns · 10 cards')
  })
})
