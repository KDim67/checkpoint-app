// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FocusRetro from '../src/renderer/src/components/focus/FocusRetro'
import type { FocusViewState } from '../src/renderer/src/components/focus/useFocusView'

afterEach(cleanup)

type Retro = Pick<FocusViewState,
  | 'elapsedTimeMs' | 'cyclesCompleted' | 'distractions' | 'retroTasks' | 'longBreakDue'
  | 'setShowDiscardConfirm' | 'handleToggleRetroTask' | 'handleSaveRetrospective' | 'handleStartBreak'>
type Task = FocusViewState['retroTasks'][number]

const task = (id: string, title: string, completed: boolean) => ({ id, title, completed }) as Task

/** The notes are typed into the view's state, so the harness holds them. */
function Retrospective({ retro }: { retro: Retro }) {
  const [retroNotes, setRetroNotes] = useState('')
  return <FocusRetro focusView={{ ...retro, retroNotes, setRetroNotes } as FocusViewState} />
}

const renderRetro = (overrides: Partial<Retro> = {}) => {
  const retro: Retro = {
    elapsedTimeMs: 25 * 60000,
    cyclesCompleted: 1,
    distractions: 0,
    longBreakDue: false,
    retroTasks: [task('t1', 'Write the migration', true), task('t2', 'Review the pull request', false)],
    setShowDiscardConfirm: vi.fn(),
    handleToggleRetroTask: vi.fn(),
    handleSaveRetrospective: vi.fn(),
    handleStartBreak: vi.fn(),
    ...overrides
  }
  render(<Retrospective retro={retro} />)
  return retro
}

describe('FocusRetro', () => {
  it('sums up the session: minutes focused, tasks done, interruptions', () => {
    renderRetro({ distractions: 3 })

    expect(screen.getByText('25m')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('counts a session shorter than a minute as one minute, not zero', () => {
    renderRetro({ elapsedTimeMs: 20000 })

    expect(screen.getByText('1m')).toBeTruthy()
  })

  it('recommends a long break only when one is due', () => {
    renderRetro()
    expect(screen.queryByText(/long break is recommended/)).toBeNull()
    cleanup()

    renderRetro({ longBreakDue: true, cyclesCompleted: 4 })
    expect(screen.getByText(/completed 4 focus intervals/)).toBeTruthy()
  })

  it('ticks a task by clicking anywhere on its row', () => {
    const retro = renderRetro()

    fireEvent.click(screen.getByText('Review the pull request'))

    expect(retro.handleToggleRetroTask).toHaveBeenCalledWith('t2')
  })

  it('says so when no tasks were picked for the session', () => {
    renderRetro({ retroTasks: [] })

    expect(screen.getByText('No tasks selected for this session.')).toBeTruthy()
    expect(screen.getByText('0/0')).toBeTruthy()
  })

  it('keeps the notes as they are typed', () => {
    renderRetro()
    const notes = screen.getByLabelText('What did you accomplish or learn? (Retrospective Notes)') as HTMLTextAreaElement

    fireEvent.change(notes, { target: { value: 'The index needed a second column' } })

    expect(notes.value).toBe('The index needed a second column')
  })

  it('starts either break, asks before discarding, and saves', () => {
    const retro = renderRetro()

    fireEvent.click(screen.getByTitle('Save this session and start a 5-minute break'))
    fireEvent.click(screen.getByTitle('Save this session and start a 15-minute break'))
    fireEvent.click(screen.getByText('Discard'))
    fireEvent.click(screen.getByText('Save & Log Session'))

    expect(retro.handleStartBreak).toHaveBeenNthCalledWith(1, 'short-break')
    expect(retro.handleStartBreak).toHaveBeenNthCalledWith(2, 'long-break')
    expect(retro.setShowDiscardConfirm).toHaveBeenCalledWith(true)
    expect(retro.handleSaveRetrospective).toHaveBeenCalledTimes(1)
  })
})
