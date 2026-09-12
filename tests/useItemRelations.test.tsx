// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Item, Relation } from '../src/shared/types'
import { searchItems } from '../src/renderer/src/data/items'
import { createRelation, deleteRelation, getRelations } from '../src/renderer/src/data/relations'
import { useItemRelations } from '../src/renderer/src/components/ui/useItemRelations'

vi.mock('../src/renderer/src/data/items', () => ({ searchItems: vi.fn() }))
vi.mock('../src/renderer/src/data/relations', () => ({ getRelations: vi.fn(), createRelation: vi.fn(), deleteRelation: vi.fn() }))

type SearchResult = Awaited<ReturnType<typeof searchItems>>

const item = (id: string): Item => ({
  id, type: 'card', context: 'dev', title: id, body: '', status: 'todo', priority: 0,
  position: 0, created_at: 0, updated_at: 0, due_at: null, metadata: '{}'
} as Item)
const link = (id: string, to: string): Relation => ({ id, from_id: 'self', to_id: to, type: 'relates_to' })

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(searchItems).mockReset()
  vi.mocked(getRelations).mockReset()
  vi.mocked(createRelation).mockReset()
  vi.mocked(deleteRelation).mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useItemRelations', () => {
  it('searches once typing settles, and leaves the item itself out', async () => {
    vi.mocked(searchItems).mockResolvedValue({ items: [item('self'), item('other')] } as SearchResult)
    const { result } = renderHook(() => useItemRelations('self', item('self'), 'dev'))

    act(() => result.current.setQuery('ot'))
    act(() => result.current.setQuery('oth'))
    expect(searchItems).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    expect(searchItems).toHaveBeenCalledTimes(1)
    expect(searchItems).toHaveBeenCalledWith({ query: 'oth', context: 'dev' })
    expect(result.current.results.map(i => i.id)).toEqual(['other'])
  })

  it('clears the results as soon as the search is emptied', async () => {
    vi.mocked(searchItems).mockResolvedValue({ items: [item('other')] } as SearchResult)
    const { result } = renderHook(() => useItemRelations('self', item('self'), 'dev'))
    act(() => result.current.setQuery('oth'))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    act(() => result.current.setQuery('   '))

    expect(result.current.results).toEqual([])
    expect(searchItems).toHaveBeenCalledTimes(1)
  })

  it('links with the chosen type, reloads the links and resets the search', async () => {
    vi.mocked(createRelation).mockResolvedValue(link('r1', 'other'))
    vi.mocked(getRelations).mockResolvedValue([link('r1', 'other')])
    const { result } = renderHook(() => useItemRelations('self', item('self'), 'dev'))
    act(() => { result.current.setType('blocks'); result.current.setQuery('oth') })

    await act(async () => { await result.current.add('other') })

    expect(createRelation).toHaveBeenCalledWith('self', 'other', 'blocks')
    expect(result.current.relations).toEqual([link('r1', 'other')])
    expect(result.current.query).toBe('')
  })

  it('does not link anything before the item has loaded', async () => {
    const { result } = renderHook(() => useItemRelations('self', null, 'dev'))

    await act(async () => { await result.current.add('other') })

    expect(createRelation).not.toHaveBeenCalled()
  })

  it('drops a link once it is deleted, and keeps it when the delete fails', async () => {
    const { result } = renderHook(() => useItemRelations('self', item('self'), 'dev'))
    act(() => result.current.setRelations([link('r1', 'a'), link('r2', 'b')]))

    vi.mocked(deleteRelation).mockResolvedValueOnce(undefined as Awaited<ReturnType<typeof deleteRelation>>)
    await act(async () => { await result.current.remove('r1') })
    expect(result.current.relations.map(r => r.id)).toEqual(['r2'])

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteRelation).mockRejectedValueOnce(new Error('locked'))
    await act(async () => { await result.current.remove('r2') })
    expect(result.current.relations.map(r => r.id)).toEqual(['r2'])
    quiet.mockRestore()
  })
})
