import { describe, it, expect } from 'vitest'
import { normalizeBoardConfig } from '../src/shared/boardModel'
import {
  buildTemplateCards,
  buildTemplateColumns,
  DEFAULT_TEMPLATE_ID,
  describeTemplate,
  findProjectTemplate,
  PROJECT_TEMPLATES,
  templateColumnId,
  type ProjectTemplate
} from '../src/shared/projectTemplates'
import { defined } from './helpers/defined'

describe('the shipped templates', () => {
  it('all have a unique id', () => {
    const ids = PROJECT_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the default the picker starts on', () => {
    expect(findProjectTemplate(DEFAULT_TEMPLATE_ID)).not.toBeNull()
  })

  it('returns null for an id that no longer exists', () => {
    expect(findProjectTemplate('removed-template')).toBeNull()
  })

  it('all have at least one column, so the board is never unusable', () => {
    for (const t of PROJECT_TEMPLATES) {
      expect(t.columns.length).toBeGreaterThan(0)
    }
  })

  it('give every column a distinct id within its own template', () => {
    for (const t of PROJECT_TEMPLATES) {
      const ids = buildTemplateColumns(t).map(c => c.id)
      expect(new Set(ids).size, `duplicate column id in "${t.id}"`).toBe(ids.length)
    }
  })

  it('only place cards in columns the template actually defines', () => {
    for (const t of PROJECT_TEMPLATES) {
      const names = new Set(t.columns.map(c => c.name.toLowerCase()))
      for (const card of t.cards) {
        expect(names.has(card.column.toLowerCase()), `"${card.column}" in "${t.id}"`).toBe(true)
      }
    }
  })

  it('survive the board normaliser unchanged', () => {
    for (const t of PROJECT_TEMPLATES) {
      const columns = buildTemplateColumns(t)
      const normalized = normalizeBoardConfig({ version: 1, columns })
      expect(normalized.columns.map(c => c.id), t.id).toEqual(columns.map(c => c.id))
    }
  })
})

describe('templateColumnId', () => {
  it('derives the id the board would derive from the same name', () => {
    expect(templateColumnId('In Progress')).toBe('in_progress')
    expect(templateColumnId('  Needs Verification ')).toBe('needs_verification')
  })
})

describe('buildTemplateColumns', () => {
  it('carries the wip limit and the definition of done', () => {
    const template: ProjectTemplate = {
      id: 't',
      name: 'T',
      description: '',
      columns: [{ name: 'Doing', wipLimit: 2, description: 'One at a time.' }],
      cards: []
    }
    expect(buildTemplateColumns(template)).toEqual([
      { id: 'doing', name: 'Doing', wipLimit: 2, description: 'One at a time.' }
    ])
  })

  it('treats an absent limit as no limit', () => {
    const template: ProjectTemplate = {
      id: 't',
      name: 'T',
      description: '',
      columns: [{ name: 'Ideas' }],
      cards: []
    }
    expect(buildTemplateColumns(template)[0].wipLimit).toBeNull()
  })
})

describe('buildTemplateCards', () => {
  const template: ProjectTemplate = {
    id: 't',
    name: 'T',
    description: '',
    columns: [{ name: 'To Do' }, { name: 'Doing' }],
    cards: [
      { title: 'First', column: 'To Do', priority: 3, checklist: ['a', 'b'] },
      { title: 'Second', column: 'To Do' },
      { title: 'Third', column: 'Doing', body: 'Body text.' }
    ]
  }

  it('resolves each card to its column id', () => {
    expect(buildTemplateCards(template).map(c => c.status)).toEqual(['to_do', 'to_do', 'doing'])
  })

  it('spaces positions within a column so a drag has room to land', () => {
    const drafts = buildTemplateCards(template)
    expect(drafts[0].position).toBe(1000)
    expect(drafts[1].position).toBe(2000)
    // Third is first in its own column, so it restarts.
    expect(drafts[2].position).toBe(1000)
  })

  it('seeds the checklist unchecked, with ids of its own', () => {
    const meta = JSON.parse(buildTemplateCards(template)[0].metadata)
    expect(meta.checklist).toHaveLength(2)
    expect(meta.checklist.every((i: { done: boolean }) => i.done === false)).toBe(true)
    expect(new Set(meta.checklist.map((i: { id: string }) => i.id)).size).toBe(2)
  })

  it('marks seeded cards as ordinary cards, not card templates', () => {
    for (const draft of buildTemplateCards(template)) {
      expect(JSON.parse(draft.metadata).isTemplate).toBe(false)
    }
  })

  it('defaults body and priority rather than leaving them undefined', () => {
    const [, second] = buildTemplateCards(template)
    expect(second.body).toBe('')
    expect(second.priority).toBe(0)
  })

  it('falls back to the first column when a card names one that is missing', () => {
    const typo: ProjectTemplate = {
      ...template,
      cards: [{ title: 'Stray', column: 'Nowhere' }]
    }
    expect(buildTemplateCards(typo)[0].status).toBe('to_do')
  })

  it('produces nothing for a template with no columns', () => {
    const empty: ProjectTemplate = { ...template, columns: [] }
    expect(buildTemplateCards(empty)).toEqual([])
  })
})

describe('describeTemplate', () => {
  it('mentions cards only when there are some', () => {
    const blank = defined(findProjectTemplate('blank'))
    expect(describeTemplate(blank)).toBe('4 columns')
  })

  it('counts both when a template seeds cards', () => {
    const software = defined(findProjectTemplate('software'))
    expect(describeTemplate(software)).toBe('5 columns · 3 cards')
  })
})
