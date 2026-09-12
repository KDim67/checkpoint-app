import { describe, it, expect } from 'vitest'
import {
  collectLabels,
  describeImport,
  detectImportSource,
  parseForeignBoard,
  parseTrelloBoard,
  trelloLabelColor
} from '../src/shared/foreignImport'
import { defined } from './helpers/defined'

/** A minimal but realistic Trello export. */
const trello = {
  name: 'Game Jam',
  lists: [
    { id: 'l2', name: 'Doing', closed: false, pos: 200 },
    { id: 'l1', name: 'To Do', closed: false, pos: 100 },
    { id: 'l3', name: 'Done', closed: false, pos: 300 }
  ],
  cards: [
    { id: 'c1', name: 'Player movement', desc: 'WASD', idList: 'l1', closed: false, pos: 100, labels: [{ name: 'code', color: 'blue' }] },
    { id: 'c2', name: 'Tileset', desc: '', idList: 'l1', closed: false, pos: 200, labels: [{ name: 'art', color: 'purple' }] },
    { id: 'c3', name: 'Jump feel', desc: '', idList: 'l2', closed: false, pos: 50, due: '2026-06-15T09:00:00.000Z', labels: [] }
  ],
  checklists: [
    {
      id: 'k1',
      idCard: 'c1',
      name: 'Steps',
      checkItems: [
        { name: 'Walk', state: 'complete', pos: 2 },
        { name: 'Run', state: 'incomplete', pos: 1 }
      ]
    }
  ]
}

describe('detectImportSource', () => {
  it('recognises a Trello export by its lists and cards', () => {
    expect(detectImportSource(trello)).toBe('trello')
  })

  it("does not claim Checkpoint's own export", () => {
    // Its shape is { context, items, tags }. Neither lists nor cards.
    expect(detectImportSource({ context: 'work', items: [], tags: [] })).toBeNull()
  })

  it('returns null for anything else', () => {
    expect(detectImportSource(null)).toBeNull()
    expect(detectImportSource([])).toBeNull()
    expect(detectImportSource('nope')).toBeNull()
    expect(detectImportSource({ lists: [] })).toBeNull()
  })
})

describe('parseTrelloBoard', () => {
  it('takes the board name as the workspace name', () => {
    expect(defined(parseTrelloBoard(trello)).name).toBe('Game Jam')
  })

  it('orders columns by Trello position, not array order', () => {
    // The fixture deliberately lists Doing before To Do.
    expect(defined(parseTrelloBoard(trello)).columns.map(c => c.name)).toEqual(['To Do', 'Doing', 'Done'])
  })

  it('derives column ids the same way board templates do', () => {
    expect(defined(parseTrelloBoard(trello)).columns.map(c => c.id)).toEqual(['to_do', 'doing', 'done'])
  })

  it('keeps two lists with the same name apart', () => {
    // A duplicate id would silently merge them and lose a column.
    const board = defined(parseTrelloBoard({
      name: 'B',
      lists: [
        { id: 'a', name: 'Review', pos: 1 },
        { id: 'b', name: 'Review', pos: 2 }
      ],
      cards: [
        { id: 'x', name: 'One', idList: 'a', pos: 1 },
        { id: 'y', name: 'Two', idList: 'b', pos: 2 }
      ]
    }))
    expect(board.columns.map(c => c.id)).toEqual(['review', 'review_2'])
    expect(board.cards.map(c => c.status)).toEqual(['review', 'review_2'])
  })

  it('places each card in its own list', () => {
    const board = defined(parseTrelloBoard(trello))
    const byTitle = Object.fromEntries(board.cards.map(c => [c.title, c.status]))
    expect(byTitle['Player movement']).toBe('to_do')
    expect(byTitle['Jump feel']).toBe('doing')
  })

  it('spaces positions within a column the way the board does', () => {
    const board = defined(parseTrelloBoard(trello))
    const todo = board.cards.filter(c => c.status === 'to_do')
    expect(todo.map(c => c.position)).toEqual([1000, 2000])
  })

  it('carries the description and the due date', () => {
    const board = defined(parseTrelloBoard(trello))
    expect(defined(board.cards.find(c => c.title === 'Player movement')).body).toBe('WASD')
    expect(defined(board.cards.find(c => c.title === 'Jump feel')).due_at).toBe(Date.parse('2026-06-15T09:00:00.000Z'))
  })

  it('leaves the due date null when there is none or it is unparseable', () => {
    const board = defined(parseTrelloBoard({
      ...trello,
      cards: [{ id: 'z', name: 'No due', idList: 'l1', pos: 1, due: 'not a date' }]
    }))
    expect(board.cards[0].due_at).toBeNull()
  })

  it('does not invent a priority Trello never had', () => {
    for (const card of defined(parseTrelloBoard(trello)).cards) {
      expect(card.priority).toBe(0)
    }
  })

  it('brings checklists across in their own order', () => {
    const card = defined(defined(parseTrelloBoard(trello)).cards.find(c => c.title === 'Player movement'))
    expect(card.checklist).toEqual([
      { text: 'Run', done: false },
      { text: 'Walk', done: true }
    ])
  })

  it('imports archived cards as archived rather than dropping them', () => {
    const board = defined(parseTrelloBoard({
      ...trello,
      cards: [{ id: 'c9', name: 'Old idea', idList: 'l1', closed: true, pos: 1 }]
    }))
    expect(board.cards[0].status).toBe('archived')
    expect(board.notes.join(' ')).toContain('archived')
  })

  it('rescues a card whose list was archived instead of losing it', () => {
    const board = defined(parseTrelloBoard({
      name: 'B',
      lists: [
        { id: 'open', name: 'To Do', closed: false, pos: 1 },
        { id: 'gone', name: 'Old', closed: true, pos: 2 }
      ],
      cards: [{ id: 'c', name: 'Orphan', idList: 'gone', closed: false, pos: 1 }]
    }))
    expect(board.cards[0].status).toBe('to_do')
    expect(board.notes.join(' ')).toContain('archived list')
  })

  it('skips cards with no title', () => {
    const board = defined(parseTrelloBoard({ ...trello, cards: [{ id: 'e', name: '   ', idList: 'l1', pos: 1 }] }))
    expect(board.cards).toEqual([])
  })

  it('refuses a board with no open lists rather than making one up', () => {
    expect(parseTrelloBoard({ name: 'B', lists: [{ id: 'a', name: 'X', closed: true }], cards: [] })).toBeNull()
  })

  it('survives junk in every field', () => {
    const board = defined(parseTrelloBoard({
      name: 42,
      lists: [{ id: 'a', name: null, pos: 'x' }, 'nonsense', null],
      cards: [{ id: 'c', name: 'Fine', idList: 'a' }, 7, null],
      checklists: ['bad', { idCard: 'c', checkItems: 'no' }]
    }))
    expect(board.name).toBe('Imported board')
    expect(board.columns).toHaveLength(1)
    expect(board.cards).toHaveLength(1)
    expect(board.cards[0].checklist).toEqual([])
  })
})

describe('trelloLabelColor', () => {
  it('maps Trello colours to hex', () => {
    expect(trelloLabelColor('blue')).toBe('#0079bf')
    expect(trelloLabelColor('green')).toBe('#61bd4f')
  })

  it('handles the light and dark variants Trello also emits', () => {
    expect(trelloLabelColor('blue_light')).toBe('#0079bf')
    expect(trelloLabelColor('red_dark')).toBe('#eb5a46')
  })

  it('falls back to grey for an unknown or missing colour', () => {
    expect(trelloLabelColor('chartreuse')).toBe('#6b7280')
    expect(trelloLabelColor(null)).toBe('#6b7280')
  })
})

describe('collectLabels', () => {
  it('gathers each distinct label once, with its colour', () => {
    expect(collectLabels(defined(parseTrelloBoard(trello)))).toEqual([
      { name: 'code', color: '#0079bf' },
      { name: 'art', color: '#c377e0' }
    ])
  })

  it('keeps the first colour when a name appears under two', () => {
    const board = defined(parseTrelloBoard({
      ...trello,
      cards: [
        { id: 'a', name: 'A', idList: 'l1', pos: 1, labels: [{ name: 'dup', color: 'blue' }] },
        { id: 'b', name: 'B', idList: 'l1', pos: 2, labels: [{ name: 'dup', color: 'red' }] }
      ]
    }))
    expect(collectLabels(board)).toEqual([{ name: 'dup', color: '#0079bf' }])
  })
})

describe('parseForeignBoard', () => {
  it('routes a Trello file to the Trello parser', () => {
    expect(parseForeignBoard(trello)?.source).toBe('trello')
  })

  it('returns null for a format it does not know', () => {
    expect(parseForeignBoard({ tasks: [] })).toBeNull()
  })
})

describe('describeImport', () => {
  it('counts what is about to be created', () => {
    expect(describeImport(defined(parseTrelloBoard(trello)))).toBe('3 columns · 3 cards')
  })
})
