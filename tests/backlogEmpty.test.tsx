// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../src/renderer/src/components/ui/Toast'
import { ConfirmProvider } from '../src/renderer/src/components/ui/ConfirmDialog'
import { useAppStore } from '../src/renderer/src/store/appStore'

vi.mock('../src/renderer/src/data/items', () => ({
  queryTasks: vi.fn(async () => ({ items: [], total: 0 })),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  bulkDeleteItems: vi.fn(),
  bulkUpdateItems: vi.fn()
}))
vi.mock('../src/renderer/src/data/tags', () => ({ listTags: vi.fn(async () => []) }))
vi.mock('../src/renderer/src/data/app', () => ({ openExternal: vi.fn(), platform: () => 'win32' }))
vi.mock('../src/renderer/src/lib/boardConfig', () => ({
  loadBoardConfig: vi.fn(async () => ({ columns: [{ id: 'todo', name: 'To Do', wipLimit: null }] }))
}))
vi.mock('../src/renderer/src/lib/settings', () => ({
  getJsonSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  getStringSetting: vi.fn(async (_key: string, fallback: string) => fallback),
  setJsonSetting: vi.fn(async () => {})
}))
vi.mock('../src/renderer/src/lib/useAiEnabled', () => ({ useAiEnabled: () => false }))

beforeEach(() => {
  useAppStore.setState({ activeWorkspace: 'work', pendingViewId: null })
})

afterEach(cleanup)

async function show(): Promise<void> {
  const { default: BacklogView } = await import('../src/renderer/src/components/BacklogView')
  await act(async () => { render(<ToastProvider><ConfirmProvider><BacklogView /></ConfirmProvider></ToastProvider>) })
}

describe('an empty backlog', () => {
  it('points at the box to type in, with no button that would only move the cursor there', async () => {
    await show()
    expect(await screen.findByText('No tasks yet')).toBeTruthy()
    expect(screen.getByText(/Type one in the box above/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /New Task|Create Task/i })).toBeNull()
  })

  it('says nothing matched a search, and clears it to bring everything back', async () => {
    vi.useFakeTimers()
    try {
      await show()
      fireEvent.change(screen.getByPlaceholderText('Search tasks…'), { target: { value: 'zzzz' } })
      await act(async () => { vi.advanceTimersByTime(250) })
      expect(screen.getByText('Nothing matches')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
      await act(async () => { vi.advanceTimersByTime(250) })
      expect((screen.getByPlaceholderText('Search tasks…') as HTMLInputElement).value).toBe('')
      expect(screen.getByText('No tasks yet')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the saved view that shows nothing, and leaves it to show every task', async () => {
    useAppStore.setState({ pendingViewId: 'view-overdue' })
    await show()
    expect(await screen.findByText('Nothing in Overdue')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' }))
    expect(await screen.findByText('No tasks yet')).toBeTruthy()
  })
})
