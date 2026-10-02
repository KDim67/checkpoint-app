// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import DueDateField from '../src/renderer/src/components/ui/DueDateField'
import { isAllDay } from '../src/shared/dueDate'

afterEach(cleanup)

const field = () => screen.getByLabelText('Due date') as HTMLInputElement

describe('typing a due date', () => {
  it('reads words as a date and saves it on Enter', () => {
    const onChange = vi.fn()
    render(<DueDateField value={null} onChange={onChange} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'tomorrow 5pm' } })
    expect(screen.getByText(/^Due Tomorrow/)).toBeTruthy()
    fireEvent.keyDown(field(), { key: 'Enter' })

    const saved = new Date(onChange.mock.calls[0][0] as number)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(saved.getDate()).toBe(tomorrow.getDate())
    expect(saved.getHours()).toBe(17)
  })

  it('saves a day said without a time as that whole day', () => {
    const onChange = vi.fn()
    render(<DueDateField value={null} onChange={onChange} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'tomorrow' } })
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(isAllDay(onChange.mock.calls[0][0] as number)).toBe(true)
  })

  it('says so when the words are not a date, and changes nothing', () => {
    const onChange = vi.fn()
    render(<DueDateField value={null} onChange={onChange} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'whenever' } })
    expect(screen.getByText(/Not a date I can read/)).toBeTruthy()
    fireEvent.keyDown(field(), { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears from the button, and takes a calendar day in local time', () => {
    const onChange = vi.fn()
    const due = new Date(2026, 9, 12, 17, 30).getTime()
    const { container } = render(<DueDateField value={due} onChange={onChange} />)

    const picker = container.querySelector('input[type="date"]') as HTMLInputElement
    expect(picker.value).toBe('2026-10-12')
    fireEvent.change(picker, { target: { value: '2026-10-20' } })
    // the day moves, the time of day stays
    expect(new Date(onChange.mock.calls[0][0] as number)).toStrictEqual(new Date(2026, 9, 20, 17, 30, 0, 0))

    fireEvent.click(screen.getByLabelText('Clear the due date'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
