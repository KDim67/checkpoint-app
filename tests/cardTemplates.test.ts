import { describe, it, expect } from 'vitest'
import { cardFromTemplate, isTemplateCard } from '../src/shared/cardTemplates'
import type { Item } from '../src/shared/types'

const card = (over: Partial<Item> = {}): Item => ({
  id: 'c1',
  type: 'card',
  context: 'work',
  title: 'Bug report',
  body: 'Steps to reproduce',
  status: 'todo',
  priority: 2,
  position: 1000,
  created_at: 1,
  updated_at: 1,
  due_at: null,
  metadata: '{}',
  tags: [],
  ...over
})

const columns = [{ id: 'todo' }, { id: 'doing' }]

describe('isTemplateCard', () => {
  it('reads the template flag from the metadata', () => {
    expect(isTemplateCard(card({ metadata: '{"isTemplate":true}' }))).toBe(true)
    expect(isTemplateCard(card({ metadata: '{"isTemplate":"yes"}' }))).toBe(false)
    expect(isTemplateCard(card())).toBe(false)
  })

  it('treats unreadable metadata as not a template', () => {
    expect(isTemplateCard(card({ metadata: '{broken' }))).toBe(false)
    expect(isTemplateCard(card({ metadata: '' }))).toBe(false)
  })
})

describe('cardFromTemplate', () => {
  it('copies the content into the template column, below what is already there', () => {
    const template = card({ id: 't', status: 'doing', metadata: '{"isTemplate":true}' })
    const board = [card({ id: 'a', status: 'doing', position: 3000 }), card({ id: 'b', status: 'todo', position: 9000 })]

    const made = cardFromTemplate(template, columns, board, 'work', 42)

    expect(made?.payload).toMatchObject({
      type: 'card',
      context: 'work',
      title: 'Bug report (Copy)',
      body: 'Steps to reproduce',
      status: 'doing',
      priority: 2,
      position: 4000,
      due_at: null
    })
  })

  it('lands in the first column when the template column is gone', () => {
    const made = cardFromTemplate(card({ status: 'removed' }), columns, [], 'work', 42)
    expect(made?.payload.status).toBe('todo')
    expect(made?.payload.position).toBe(1000)
  })

  it('makes nothing on a board with no columns', () => {
    expect(cardFromTemplate(card(), [], [], 'work', 42)).toBeNull()
  })

  it('keeps the template metadata but not its comments, activity or template flag', () => {
    const template = card({
      metadata: JSON.stringify({ isTemplate: true, checklist: [{ text: 'Repro' }], comments: [{ text: 'old' }], activities: [{ id: 'x' }] })
    })

    const made = cardFromTemplate(template, columns, [], 'work', 42)
    const meta = JSON.parse(made?.payload.metadata ?? 'null')

    expect(meta).toEqual({
      isTemplate: false,
      checklist: [{ text: 'Repro' }],
      comments: [],
      activities: [{ id: 'act-42', text: 'Card created from template "Bug report"', createdAt: 42 }]
    })
  })

  it('starts from empty metadata when the template has none that reads', () => {
    const made = cardFromTemplate(card({ metadata: '{broken' }), columns, [], 'work', 42)
    const meta = JSON.parse(made?.payload.metadata ?? 'null')
    expect(meta.isTemplate).toBe(false)
    expect(meta.comments).toEqual([])
  })

  it('carries the template tags over by id', () => {
    const template = card({ tags: [{ id: 'g1', name: 'bug', color: '#f00' }, { id: 'g2', name: 'ui', color: '#0f0' }] })
    expect(cardFromTemplate(template, columns, [], 'work', 42)?.tagIds).toEqual(['g1', 'g2'])
    expect(cardFromTemplate(card({ tags: undefined }), columns, [], 'work', 42)?.tagIds).toEqual([])
  })
})
