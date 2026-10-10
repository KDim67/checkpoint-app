import { describe, expect, it } from 'vitest'
import { dateCandidates, doneCandidates, isNotionId, notionPriority, opensNotion, resolveColumns, type NotionProperty } from '../src/shared/notion'
import { linkOf } from '../src/shared/connections'

const status = (id: string, name: string, groups = [
  { name: 'To-do', optionIds: ['o-todo'] },
  { name: 'In progress', optionIds: ['o-doing'] },
  { name: 'Complete', optionIds: ['o-done', 'o-shipped'] }
]): NotionProperty => ({ id, name, type: 'status', options: [], groups })

const SCHEMA: NotionProperty[] = [
  { id: 'title', name: 'Name', type: 'title' },
  status('s1', 'Status'),
  { id: 'c1', name: 'Archived', type: 'checkbox' },
  { id: 'd1', name: 'Due', type: 'date' },
  { id: 'd2', name: 'Created on', type: 'date' },
  { id: 't1', name: 'Tags', type: 'multi_select' },
  { id: 'p1', name: 'Priority', type: 'select' }
]

describe('which Notion columns mean what', () => {
  it('takes the first status for done and the first date, unless others were picked', () => {
    expect(resolveColumns(SCHEMA)).toStrictEqual({
      title: 'title',
      done: { kind: 'status', id: 's1', name: 'Status', complete: ['o-done', 'o-shipped'], doneOption: 'o-done', openOption: 'o-todo' },
      date: { id: 'd1', name: 'Due' },
      tags: 't1',
      priority: 'p1'
    })
    expect(resolveColumns(SCHEMA, { done: 'c1', date: 'd2' })).toMatchObject({ done: { kind: 'checkbox', id: 'c1' }, date: { id: 'd2' } })
    expect(resolveColumns(SCHEMA, { done: 'gone', date: 'gone' })).toMatchObject({ done: { id: 's1' }, date: { id: 'd1' } })
  })

  it('falls back to a checkbox, and finds nothing usable in a database without either', () => {
    expect(resolveColumns(SCHEMA.filter(p => p.type !== 'status')).done).toStrictEqual({ kind: 'checkbox', id: 'c1', name: 'Archived' })
    expect(resolveColumns([{ id: 'title', name: 'Name', type: 'title' }]).done).toBeNull()
    expect(resolveColumns([status('s', 'Stage', [{ name: 'Only', optionIds: ['x'] }])]).done).toBeNull()
  })

  it('reads a status whose groups were renamed by their order', () => {
    const renamed = status('s', 'Stage', [{ name: 'Waiting', optionIds: ['w'] }, { name: 'Finished', optionIds: ['f'] }])
    expect(resolveColumns([renamed]).done).toMatchObject({ doneOption: 'f', openOption: 'w' })
  })

  it('lists what can be picked for each', () => {
    expect(doneCandidates(SCHEMA).map(p => p.name)).toStrictEqual(['Status', 'Archived'])
    expect(dateCandidates(SCHEMA).map(p => p.name)).toStrictEqual(['Due', 'Created on'])
  })
})

describe('Notion names', () => {
  it('accepts its ids with or without dashes, and opens only notion pages', () => {
    expect(isNotionId('be633bf1-dfa0-436d-b259-571129a590e5')).toBe(true)
    expect(isNotionId('be633bf1dfa0436db259571129a590e5')).toBe(true)
    expect(isNotionId('../users/me')).toBe(false)
    expect(opensNotion('https://www.notion.so/Bug-bash-be633bf1dfa0436db259571129a590e5')).toBe(true)
    expect(opensNotion('https://notion.com/x')).toBe(true)
    expect(opensNotion('https://notion.so.evil.example/x')).toBe(false)
    expect(linkOf(JSON.stringify({ link: { service: 'notion', id: 'be633bf1-dfa0-436d-b259-571129a590e5', url: 'https://www.notion.so/x-be633bf1', state: 'open', labels: [] } }))?.service).toBe('notion')
  })

  it('reads common priority names, and none for others', () => {
    expect(['Urgent', 'High', 'Medium', 'Low', 'P1', 'Someday', undefined].map(notionPriority)).toStrictEqual([3, 3, 2, 1, 3, 0, 0])
  })
})
