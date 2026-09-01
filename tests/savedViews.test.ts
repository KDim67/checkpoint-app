import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_VIEWS,
  createSavedView,
  describeView,
  normalizeSavedView,
  normalizeSavedViews,
  resolveDueRange,
  toQueryParams,
  type SavedView
} from '../src/shared/savedViews'

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime()

const view = (over: Partial<SavedView> = {}): SavedView => ({
  id: 'v1',
  name: 'A view',
  scope: 'current',
  due: 'any',
  ...over
})

describe('resolveDueRange', () => {
  const now = at(2026, 6, 15, 9, 30)

  it('constrains nothing for "any"', () => {
    expect(resolveDueRange('any', now)).toEqual({})
  })

  it('treats overdue as everything up to this instant', () => {
    // Not up to midnight: something due at 5pm is not overdue at 9:30am.
    expect(resolveDueRange('overdue', now)).toEqual({ dueEnd: now })
  })

  it('bounds today to the calendar day', () => {
    const range = resolveDueRange('today', now)
    expect(new Date(range.dueStart!).getHours()).toBe(0)
    expect(new Date(range.dueEnd!).getHours()).toBe(23)
    expect(new Date(range.dueStart!).getDate()).toBe(15)
    expect(new Date(range.dueEnd!).getDate()).toBe(15)
  })

  it('rolls the week forward rather than emptying every Sunday', () => {
    const range = resolveDueRange('week', now)
    expect(new Date(range.dueStart!).getDate()).toBe(15)
    expect(new Date(range.dueEnd!).getDate()).toBe(21)
  })

  it('asks for the absence of a date rather than an open range', () => {
    // A task with no due date satisfies no range at all, so this cannot be
    // expressed as dueStart/dueEnd.
    expect(resolveDueRange('none', now)).toEqual({ noDueDate: true })
  })

  it('re-resolves against the moment it is asked, not the one it was saved at', () => {
    const monday = resolveDueRange('overdue', at(2026, 6, 15))
    const friday = resolveDueRange('overdue', at(2026, 6, 19))
    expect(friday.dueEnd).toBeGreaterThan(monday.dueEnd!)
  })
})

describe('toQueryParams', () => {
  const now = at(2026, 6, 15)

  it('omits every filter that is not set', () => {
    expect(toQueryParams(view(), now)).toEqual({})
  })

  it('passes through the filters that are set', () => {
    const params = toQueryParams(
      view({ query: 'auth', status: ['open'], priority: [3], tagIds: ['t1'] }),
      now
    )
    expect(params).toMatchObject({ query: 'auth', status: ['open'], priority: [3], tagIds: ['t1'] })
  })

  it('drops empty arrays rather than sending them as filters', () => {
    // An empty status array would otherwise mean "status IN ()", no rows.
    const params = toQueryParams(view({ status: [], priority: [], tagIds: [] }), now)
    expect(params).toEqual({})
  })

  it('merges the resolved due range', () => {
    expect(toQueryParams(view({ due: 'none' }), now)).toEqual({ noDueDate: true })
  })

  it('carries untagged through', () => {
    expect(toQueryParams(view({ untagged: true }), now).untagged).toBe(true)
  })
})

describe('normalizeSavedView', () => {
  it('rejects an entry with no identity', () => {
    expect(normalizeSavedView(null)).toBeNull()
    expect(normalizeSavedView({ name: 'no id' })).toBeNull()
    expect(normalizeSavedView({ id: 'x' })).toBeNull()
  })

  it('falls back to a harmless due filter when the stored one is unknown', () => {
    expect(normalizeSavedView({ id: 'x', name: 'X', due: 'yesteryear' })?.due).toBe('any')
  })

  it('defaults the scope to the current workspace', () => {
    expect(normalizeSavedView({ id: 'x', name: 'X' })?.scope).toBe('current')
    expect(normalizeSavedView({ id: 'x', name: 'X', scope: 'all' })?.scope).toBe('all')
  })

  it('drops filters it cannot read rather than widening them', () => {
    const out = normalizeSavedView({ id: 'x', name: 'X', status: [1, null], tagIds: 'nope', query: '   ' })
    expect(out?.status).toBeUndefined()
    expect(out?.tagIds).toBeUndefined()
    expect(out?.query).toBeUndefined()
  })

  it('cleans, dedupes and sorts priorities', () => {
    expect(normalizeSavedView({ id: 'x', name: 'X', priority: [3, 3, 9, 1, -1] })?.priority).toEqual([1, 3])
  })
})

describe('normalizeSavedViews', () => {
  it('reads an array or the JSON string it is stored as', () => {
    const list = [{ id: 'a', name: 'A' }]
    expect(normalizeSavedViews(list)).toHaveLength(1)
    expect(normalizeSavedViews(JSON.stringify(list))).toHaveLength(1)
  })

  it('returns nothing for junk rather than throwing', () => {
    expect(normalizeSavedViews('{bad')).toEqual([])
    expect(normalizeSavedViews(null)).toEqual([])
    expect(normalizeSavedViews(7)).toEqual([])
  })

  it('drops duplicates and malformed entries', () => {
    const out = normalizeSavedViews([{ id: 'a', name: 'A' }, null, { id: 'a', name: 'Again' }])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('A')
  })
})

describe('createSavedView', () => {
  const base = { scope: 'current' as const, due: 'any' as const }

  it('rejects an empty name', () => {
    expect(createSavedView('  ', base, [], 1)).toEqual({ error: 'Give the view a name.' })
  })

  it('rejects a duplicate name regardless of case', () => {
    const r = createSavedView('overdue', base, [view({ name: 'Overdue' })], 1)
    expect('error' in r).toBe(true)
  })

  it('trims the name and assigns an id', () => {
    const r = createSavedView('  Mine  ', base, [], 1000)
    expect('view' in r && r.view.name).toBe('Mine')
    expect('view' in r && r.view.id).toBeTruthy()
  })

  it('does not collide when two are made in the same millisecond', () => {
    const first = createSavedView('A', base, [], 1000)
    if (!('view' in first)) throw new Error('expected a view')
    const second = createSavedView('B', base, [first.view], 1000)
    expect('view' in second && second.view.id).not.toBe(first.view.id)
  })
})

describe('describeView', () => {
  it('says so when nothing is filtered', () => {
    expect(describeView(view())).toContain('Everything')
  })

  it('names the filters that are set', () => {
    const text = describeView(view({ priority: [3], due: 'overdue', query: 'auth' }))
    expect(text).toContain('high priority')
    expect(text).toContain('overdue')
    expect(text).toContain('auth')
  })

  it('distinguishes the two scopes', () => {
    expect(describeView(view({ scope: 'all' }))).toContain('all workspaces')
    expect(describeView(view({ scope: 'current' }))).toContain('this workspace')
  })
})

describe('the shipped views', () => {
  it('survive a round trip unchanged', () => {
    expect(normalizeSavedViews(JSON.parse(JSON.stringify(BUILT_IN_VIEWS)))).toEqual(BUILT_IN_VIEWS)
  })

  it('have unique ids and names', () => {
    expect(new Set(BUILT_IN_VIEWS.map(v => v.id)).size).toBe(BUILT_IN_VIEWS.length)
    expect(new Set(BUILT_IN_VIEWS.map(v => v.name)).size).toBe(BUILT_IN_VIEWS.length)
  })

  it('are all marked builtIn, which is what protects them from deletion', () => {
    for (const v of BUILT_IN_VIEWS) expect(v.builtIn).toBe(true)
  })

  it('each actually constrain something', () => {
    // A shipped view returning everything would be a menu entry that does nothing.
    for (const v of BUILT_IN_VIEWS) {
      expect(Object.keys(toQueryParams(v, at(2026, 6, 15))).length, v.name).toBeGreaterThan(0)
    }
  })
})
