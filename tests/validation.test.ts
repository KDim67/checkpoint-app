import { describe, it, expect } from 'vitest'
import {
  CreateItemSchema,
  UpdateItemSchema,
  CreateTagSchema,
  RelationTypeSchema,
  BulkUpdateSchema,
  SearchQuerySchema,
  TaskQueryParamsSchema,
  CreateFocusSessionSchema
} from '../src/main/validation'

describe('CreateItemSchema', () => {
  it('fills every optional column so the INSERT never sees undefined', () => {
    // all twelve columns bind by name, a missing default fails at runtime
    expect(CreateItemSchema.parse({ type: 'card', context: 'inbox' })).toEqual({
      type: 'card',
      context: 'inbox',
      title: '',
      body: '',
      status: 'open',
      priority: 0,
      position: 0,
      due_at: null,
      metadata: '{}'
    })
  })

  it('rejects an empty context slug', () => {
    expect(CreateItemSchema.safeParse({ type: 'card', context: '' }).success).toBe(false)
  })

  it('rejects a type outside the three the items CHECK constraint allows', () => {
    expect(CreateItemSchema.safeParse({ type: 'epic', context: 'inbox' }).success).toBe(false)
  })

  it('rejects a stringified priority instead of coercing it', () => {
    // the CHECK would reject '2', fail here where the caller's to blame
    expect(CreateItemSchema.safeParse({ type: 'card', context: 'a', priority: '2' }).success).toBe(false)
    expect(CreateItemSchema.safeParse({ type: 'card', context: 'a', priority: 4 }).success).toBe(false)
  })

  it('rejects NaN as a board position', () => {
    expect(CreateItemSchema.safeParse({ type: 'card', context: 'a', position: NaN }).success).toBe(false)
  })

  it('accepts an arbitrary status so custom Kanban column ids pass through', () => {
    const parsed = CreateItemSchema.parse({ type: 'card', context: 'a', status: 'col_7f3a91' })
    expect(parsed.status).toBe('col_7f3a91')
  })
})

describe('UpdateItemSchema', () => {
  it('leaves an empty patch empty instead of resetting the row to defaults', () => {
    // leaked defaults would blank title, body and metadata on every partial update
    expect(UpdateItemSchema.parse({})).toEqual({})
  })

  it('carries through only the fields the caller actually sent', () => {
    expect(UpdateItemSchema.parse({ title: 'renamed' })).toEqual({ title: 'renamed' })
  })

  it('still validates the fields that are present', () => {
    expect(UpdateItemSchema.safeParse({ priority: 9 }).success).toBe(false)
    expect(UpdateItemSchema.safeParse({ type: 'note' }).success).toBe(false)
  })
})

describe('CreateTagSchema', () => {
  it('accepts only full six-digit hex colours', () => {
    expect(CreateTagSchema.safeParse({ name: 'bug', color: '#a1B2c3' }).success).toBe(true)
    expect(CreateTagSchema.safeParse({ name: 'bug', color: '#abc' }).success).toBe(false)
    expect(CreateTagSchema.safeParse({ name: 'bug', color: 'red' }).success).toBe(false)
    expect(CreateTagSchema.safeParse({ name: 'bug', color: '#a1b2c3ff' }).success).toBe(false)
  })

  it('supplies the house tag colour when none is given', () => {
    expect(CreateTagSchema.parse({ name: 'bug' }).color).toBe('#535e85')
  })

  it('rejects an empty tag name', () => {
    expect(CreateTagSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('RelationTypeSchema', () => {
  it('admits exactly the three types the relations CHECK constraint allows', () => {
    for (const type of ['blocks', 'relates_to', 'duplicates']) {
      expect(RelationTypeSchema.safeParse(type).success).toBe(true)
    }
    expect(RelationTypeSchema.safeParse('depends_on').success).toBe(false)
  })
})

describe('BulkUpdateSchema', () => {
  it('rejects an empty id string so a bulk patch can never match every row', () => {
    expect(BulkUpdateSchema.safeParse({ ids: ['a', ''], patch: { status: 'done' } }).success).toBe(false)
  })

  it('accepts an empty patch and an empty id list', () => {
    expect(BulkUpdateSchema.parse({ ids: [], patch: {} })).toEqual({ ids: [], patch: {} })
  })

  it('drops unknown patch keys rather than passing them to the UPDATE', () => {
    const parsed = BulkUpdateSchema.parse({ ids: ['a'], patch: { status: 'done', body: 'nope' } })
    expect(parsed.patch).toEqual({ status: 'done' })
  })
})

describe('search and task query schemas', () => {
  it('pages search results from zero and tasks from one', () => {
    // searchItems pages from 0, queryTasks from 1, on purpose
    expect(SearchQuerySchema.parse({ query: 'x' })).toMatchObject({ page: 0, pageSize: 20 })
    expect(TaskQueryParamsSchema.parse({})).toMatchObject({ page: 1, pageSize: 50 })
    expect(SearchQuerySchema.safeParse({ query: 'x', page: 0 }).success).toBe(true)
    expect(TaskQueryParamsSchema.safeParse({ page: 0 }).success).toBe(false)
  })

  it('rejects a negative or fractional page size', () => {
    expect(SearchQuerySchema.safeParse({ query: 'x', pageSize: 0 }).success).toBe(false)
    expect(SearchQuerySchema.safeParse({ query: 'x', pageSize: 2.5 }).success).toBe(false)
    expect(TaskQueryParamsSchema.safeParse({ pageSize: -1 }).success).toBe(false)
  })

  it('allows an empty search query but not a missing one', () => {
    expect(SearchQuerySchema.safeParse({ query: '' }).success).toBe(true)
    expect(SearchQuerySchema.safeParse({}).success).toBe(false)
  })

  it('accepts an explicitly null due-date window', () => {
    const parsed = TaskQueryParamsSchema.parse({ dueStart: null, dueEnd: null, hasRelations: null })
    expect(parsed).toMatchObject({ dueStart: null, dueEnd: null, hasRelations: null })
  })
})

describe('CreateFocusSessionSchema', () => {
  it('refuses a zero or negative session duration', () => {
    expect(CreateFocusSessionSchema.safeParse({ context: 'a', duration_ms: 0 }).success).toBe(false)
    expect(CreateFocusSessionSchema.safeParse({ context: 'a', duration_ms: -1 }).success).toBe(false)
  })

  it('defaults notes and the task list to storable strings', () => {
    expect(CreateFocusSessionSchema.parse({ context: 'a', duration_ms: 1500 })).toEqual({
      context: 'a',
      duration_ms: 1500,
      notes: '',
      tasks_json: '[]'
    })
  })
})
