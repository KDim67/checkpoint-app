import { describe, it, expect } from 'vitest'
import {
  detectImportSource,
  parseForeignBoard,
  parseTodoistBoard,
  parseTodoistCsv,
  parseCsv,
  isTodoistCsv,
  todoistPriorityFromApi,
  todoistPriorityFromCsv,
  collectLabels
} from '../src/shared/foreignImport'
import { defined } from './helpers/defined'

describe('telling a Todoist export apart', () => {
  it('recognises the Sync API shape', () => {
    expect(detectImportSource({ projects: [], items: [] })).toBe('todoist')
  })

  it('recognises the REST shape, which calls them tasks', () => {
    expect(detectImportSource({ projects: [], tasks: [] })).toBe('todoist')
  })

  it('does not mistake Checkpoint’s own export for one', () => {
    // our exports have items too, projects tell them apart
    expect(detectImportSource({ context: 'work', items: [] })).toBeNull()
  })

  it('still recognises Trello', () => {
    expect(detectImportSource({ lists: [], cards: [] })).toBe('trello')
  })
})

describe('Todoist priority, which the two exports number in opposite directions', () => {
  it('reads the API scale, where 4 is the urgent one', () => {
    expect(todoistPriorityFromApi(4)).toBe(3)
    expect(todoistPriorityFromApi(3)).toBe(2)
    expect(todoistPriorityFromApi(2)).toBe(1)
    expect(todoistPriorityFromApi(1)).toBe(0)
  })

  it('reads the CSV scale, where 1 is the urgent one', () => {
    expect(todoistPriorityFromCsv('1')).toBe(3)
    expect(todoistPriorityFromCsv('2')).toBe(2)
    expect(todoistPriorityFromCsv('3')).toBe(1)
    expect(todoistPriorityFromCsv('4')).toBe(0)
  })

  it('agrees about which end is urgent despite the opposite numbering', () => {
    // the other file's convention would invert every priority unnoticed
    expect(todoistPriorityFromApi(4)).toBe(todoistPriorityFromCsv('1'))
    expect(todoistPriorityFromApi(1)).toBe(todoistPriorityFromCsv('4'))
  })

  it('treats a missing or nonsense value as no priority', () => {
    expect(todoistPriorityFromApi(undefined)).toBe(0)
    expect(todoistPriorityFromCsv('')).toBe(0)
    expect(todoistPriorityFromCsv('banana')).toBe(0)
  })

  it('clamps rather than producing a level that does not exist', () => {
    expect(todoistPriorityFromApi(99)).toBe(3)
    expect(todoistPriorityFromCsv('0')).toBe(0)
  })
})

describe('a Todoist JSON backup', () => {
  const backup = {
    projects: [{ id: 'p1', name: 'Renovation' }],
    sections: [
      { id: 's2', name: 'Doing', project_id: 'p1', section_order: 2 },
      { id: 's1', name: 'Next up', project_id: 'p1', section_order: 1 }
    ],
    labels: [{ id: 'l1', name: 'urgent', color: 'red' }],
    items: [
      { id: 't1', content: 'Strip the wallpaper', project_id: 'p1', section_id: 's1', priority: 4, child_order: 1, labels: ['l1'], due: { date: '2026-10-01' } },
      { id: 't2', content: 'Order paint', project_id: 'p1', section_id: 's2', priority: 1, child_order: 2, description: 'Matt, not satin' },
      { id: 't3', content: 'Pick a colour', project_id: 'p1', parent_id: 't2', child_order: 3 },
      { id: 't4', content: 'Book the skip', project_id: 'p1', child_order: 4 },
      { id: 't5', content: 'Measure the room', project_id: 'p1', section_id: 's1', checked: true, child_order: 5 }
    ]
  }

  const board = defined(parseTodoistBoard(backup))

  it('uses the project name for the workspace', () => {
    expect(board.name).toBe('Renovation')
  })

  it('turns sections into columns, in the order Todoist shows them', () => {
    expect(board.columns.map(c => c.name)).toEqual(['Tasks', 'Next up', 'Doing'])
  })

  it('puts section-less tasks in the first column rather than losing them', () => {
    const skip = defined(board.cards.find(c => c.title === 'Book the skip'))
    expect(skip.status).toBe(board.columns[0].id)
  })

  it('carries description, due date and priority across', () => {
    const paint = defined(board.cards.find(c => c.title === 'Order paint'))
    expect(paint.body).toBe('Matt, not satin')
    expect(paint.priority).toBe(0)

    const strip = defined(board.cards.find(c => c.title === 'Strip the wallpaper'))
    expect(strip.priority).toBe(3)
    expect(strip.due_at).toBe(Date.parse('2026-10-01'))
  })

  it('resolves a label id to its name and colour', () => {
    expect(collectLabels(board)).toEqual([{ name: 'urgent', color: '#db4035' }])
  })

  it('makes a sub-task a checklist item rather than a card of its own', () => {
    const paint = defined(board.cards.find(c => c.title === 'Order paint'))
    expect(paint.checklist).toEqual([{ text: 'Pick a colour', done: false }])
    expect(board.cards.some(c => c.title === 'Pick a colour')).toBe(false)
  })

  it('archives a completed task instead of dropping it, and says so', () => {
    const measured = defined(board.cards.find(c => c.title === 'Measure the room'))
    expect(measured.status).toBe('archived')
    expect(board.notes.join(' ')).toContain('1 completed task')
  })

  it('gives every card a distinct position within its column', () => {
    const byColumn = new Map<string, number[]>()
    for (const card of board.cards) {
      byColumn.set(card.status, [...(byColumn.get(card.status) ?? []), card.position])
    }
    for (const positions of byColumn.values()) {
      expect(new Set(positions).size).toBe(positions.length)
    }
  })
})

describe('a Todoist backup holding several projects', () => {
  const board = defined(parseTodoistBoard({
    projects: [{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Home' }],
    sections: [{ id: 's1', name: 'Later', project_id: 'p1' }],
    items: [
      { id: 't1', content: 'Ship the release', project_id: 'p1' },
      { id: 't2', content: 'Fix the tap', project_id: 'p2' }
    ]
  }))

  it('makes the projects the columns, since their sections are not comparable', () => {
    expect(board.columns.map(c => c.name)).toEqual(['Work', 'Home'])
  })

  it('files each task under its own project', () => {
    expect(defined(board.cards.find(c => c.title === 'Fix the tap')).status).toBe(board.columns[1].id)
  })

  it('says out loud that sections were flattened', () => {
    expect(board.notes.join(' ')).toContain('flattened')
  })
})

describe('reading a CSV', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
  })

  it('keeps a newline inside a quoted field', () => {
    // multi-line descriptions would tear a naive split
    expect(parseCsv('a,"line one\nline two",c')).toEqual([['a', 'line one\nline two', 'c']])
  })

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']])
  })

  it('handles CRLF, which is what a Windows download has', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('strips a byte order mark off the first header', () => {
    // or an Excel BOM glues onto the first column name
    expect(parseCsv('﻿TYPE,CONTENT')).toEqual([['TYPE', 'CONTENT']])
  })
})

describe('a Todoist template CSV', () => {
  const csv = [
    'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE',
    'section,Next up,,,,,,,,',
    'task,Strip the wallpaper,,1,1,,,2026-10-01,en,',
    'task,Pick a colour,,4,2,,,,,',
    'note,Ask about the trim,,,,,,,,',
    ',,,,,,,,,',
    'section,Doing,,,,,,,,',
    'task,"Order paint, matt",Not satin,3,1,,,,,'
  ].join('\n')

  it('is recognised by its header', () => {
    expect(isTodoistCsv(csv)).toBe(true)
    expect(isTodoistCsv('name,email\nA,b@c.d')).toBe(false)
  })

  it('turns section rows into columns, keeping one for what came first', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    expect(board.columns.map(c => c.name)).toEqual(['Renovation', 'Next up', 'Doing'])
  })

  it('reads the CSV priority scale, not the API one', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    // PRIORITY 1 is p1; the API scale would make it lowest
    expect(defined(board.cards.find(c => c.title === 'Strip the wallpaper')).priority).toBe(3)
    expect(defined(board.cards.find(c => c.title === 'Order paint, matt')).priority).toBe(1)
  })

  it('makes an indented row a checklist item on the task above it', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    const strip = defined(board.cards.find(c => c.title === 'Strip the wallpaper'))
    expect(strip.checklist).toEqual([{ text: 'Pick a colour', done: false }])
  })

  it('appends a note row to the task it belongs to', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    const strip = defined(board.cards.find(c => c.title === 'Strip the wallpaper'))
    expect(strip.body).toContain('Ask about the trim')
  })

  it('keeps a quoted comma in a task title', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    expect(board.cards.some(c => c.title === 'Order paint, matt')).toBe(true)
  })

  it('says what a template export cannot carry', () => {
    const board = defined(parseTodoistCsv(csv, 'Renovation'))
    expect(board.notes.join(' ')).toContain('no labels')
  })

  it('refuses a file with no tasks rather than making an empty workspace', () => {
    expect(parseTodoistCsv('TYPE,CONTENT,INDENT\nsection,Empty,,', 'X')).toBeNull()
  })
})

describe('dispatching by shape', () => {
  it('routes a Todoist backup to the Todoist parser', () => {
    const board = parseForeignBoard({
      projects: [{ id: 'p1', name: 'Work' }],
      items: [{ id: 't1', content: 'Do the thing', project_id: 'p1' }]
    })
    expect(board?.source).toBe('todoist')
    expect(board?.cards[0].title).toBe('Do the thing')
  })

  it('still returns null for something it does not know', () => {
    expect(parseForeignBoard({ hello: 'world' })).toBeNull()
  })
})
