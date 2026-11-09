// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useAppStore, type ActiveView } from '../src/renderer/src/store/appStore'
import { ToastProvider, useToast } from '../src/renderer/src/components/ui/Toast'

vi.mock('../src/renderer/src/lib/settings', () => ({
  setStringSetting: vi.fn(async () => {})
}))

afterEach(cleanup)

describe('useAppStore view history navigation', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: 'kanban',
      backTrail: [],
      historyBack: [],
      historyForward: [],
      canNavigateBack: false,
      canNavigateForward: false
    })
  })

  it('tracks view navigation in historyBack and clears historyForward on new navigation', () => {
    const { setView, navigateBack, navigateForward } = useAppStore.getState()

    setView('wall')
    expect(useAppStore.getState().activeView).toBe('wall')
    expect(useAppStore.getState().historyBack).toEqual(['kanban'])
    expect(useAppStore.getState().canNavigateBack).toBe(true)
    expect(useAppStore.getState().canNavigateForward).toBe(false)

    setView('cheatsheets')
    expect(useAppStore.getState().activeView).toBe('cheatsheets')
    expect(useAppStore.getState().historyBack).toEqual(['kanban', 'wall'])

    // Navigate back to wall
    navigateBack()
    expect(useAppStore.getState().activeView).toBe('wall')
    expect(useAppStore.getState().historyBack).toEqual(['kanban'])
    expect(useAppStore.getState().historyForward).toEqual(['cheatsheets'])
    expect(useAppStore.getState().canNavigateBack).toBe(true)
    expect(useAppStore.getState().canNavigateForward).toBe(true)

    // Navigate back to kanban
    navigateBack()
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().historyBack).toEqual([])
    expect(useAppStore.getState().historyForward).toEqual(['cheatsheets', 'wall'])
    expect(useAppStore.getState().canNavigateBack).toBe(false)
    expect(useAppStore.getState().canNavigateForward).toBe(true)

    // Navigate forward to wall
    navigateForward()
    expect(useAppStore.getState().activeView).toBe('wall')
    expect(useAppStore.getState().historyBack).toEqual(['kanban'])
    expect(useAppStore.getState().historyForward).toEqual(['cheatsheets'])

    // Branching: navigating to a new view clears forward history
    setView('notes')
    expect(useAppStore.getState().activeView).toBe('notes')
    expect(useAppStore.getState().historyBack).toEqual(['kanban', 'wall'])
    expect(useAppStore.getState().historyForward).toEqual([])
    expect(useAppStore.getState().canNavigateForward).toBe(false)
  })

  it('caps history stack to 50 items', () => {
    const { setView } = useAppStore.getState()
    const views = ['kanban', 'wall', 'notes', 'log', 'calendar'] as const
    for (let i = 0; i < 60; i++) {
      setView(views[i % views.length])
    }
    expect(useAppStore.getState().historyBack.length).toBeLessThanOrEqual(50)
  })

  it('safely handles navigateBack and navigateForward at history boundaries without changing view', () => {
    const { navigateBack, navigateForward } = useAppStore.getState()

    // At initial state: no history
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().canNavigateBack).toBe(false)
    expect(useAppStore.getState().canNavigateForward).toBe(false)

    navigateBack()
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().canNavigateBack).toBe(false)

    navigateForward()
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().canNavigateForward).toBe(false)

    // With historyBack containing only identical entries
    useAppStore.setState({
      activeView: 'kanban',
      historyBack: ['kanban', 'kanban'] as ActiveView[],
      canNavigateBack: true
    })
    navigateBack()
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().canNavigateBack).toBe(false)

    // With historyForward containing only identical entries
    useAppStore.setState({
      activeView: 'kanban',
      historyForward: ['kanban', 'kanban'] as ActiveView[],
      canNavigateForward: true
    })
    navigateForward()
    expect(useAppStore.getState().activeView).toBe('kanban')
    expect(useAppStore.getState().canNavigateForward).toBe(false)
  })
})

describe('Toast Undo action and keyboard trigger', () => {
  beforeEach(() => {
    useAppStore.setState({ activeView: 'kanban' })
  })

  function Sender({ onUndo }: { onUndo: () => void }) {
    const { toast } = useToast()
    return (
      <button
        type="button"
        onClick={() => toast('Item deleted', { action: { label: 'Undo', onClick: onUndo } })}
      >
        Trigger Toast
      </button>
    )
  }

  it('renders an undo action button and calls onClick when clicked', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Sender onUndo={onUndo} />
      </ToastProvider>
    )

    fireEvent.click(screen.getByText('Trigger Toast'))
    const undoBtn = screen.getByRole('button', { name: 'Undo' })
    expect(undoBtn).toBeTruthy()

    fireEvent.click(undoBtn)
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('triggers Undo action on Ctrl+Z keydown when not in a text field', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Sender onUndo={onUndo} />
      </ToastProvider>
    )

    fireEvent.click(screen.getByText('Trigger Toast'))
    expect(screen.getByText('Undo')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('does not trigger toast Undo on Ctrl+Z when inside an input or textarea', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Sender onUndo={onUndo} />
        <input data-testid="test-input" />
      </ToastProvider>
    )

    fireEvent.click(screen.getByText('Trigger Toast'))
    const input = screen.getByTestId('test-input')
    input.focus()

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('does not trigger toast Undo on Ctrl+Z when on wall view (wall handles its own canvas undo)', () => {
    useAppStore.setState({ activeView: 'wall' })
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Sender onUndo={onUndo} />
      </ToastProvider>
    )

    fireEvent.click(screen.getByText('Trigger Toast'))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(onUndo).not.toHaveBeenCalled()
  })
})
