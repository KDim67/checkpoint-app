// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallTextEditor from '../src/renderer/src/components/wall/WallTextEditor'

afterEach(cleanup)

/** the Wall owns the text, the editor only reports it */
function Harness({ initial, onFinish = () => {} }: { initial: string; onFinish?: () => void }) {
  const [value, setValue] = useState(initial)
  return <WallTextEditor value={value} onChange={setValue} onFinish={onFinish} />
}

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement

const caretAt = (start: number, end = start) => {
  box().setSelectionRange(start, end)
}

describe('WallTextEditor', () => {
  it('leaves Enter to make a new line, and finishes on Escape or Ctrl+Enter', () => {
    const onFinish = vi.fn()
    render(<Harness initial="one" onFinish={onFinish} />)
    caretAt(3)

    // not prevented, so the textarea breaks the line itself
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(true)
    expect(onFinish).not.toHaveBeenCalled()

    fireEvent.keyDown(box(), { key: 'Escape' })
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true })
    expect(onFinish).toHaveBeenCalledTimes(2)
  })

  it('continues a list on Enter', () => {
    render(<Harness initial="- one" />)
    caretAt(5)

    fireEvent.keyDown(box(), { key: 'Enter' })

    expect(box().value).toBe('- one\n- ')
    expect(box().selectionStart).toBe(8)
  })

  it('bolds the selection with Ctrl+B and italicises it with Ctrl+I', () => {
    render(<Harness initial="make bold" />)
    caretAt(5, 9)

    fireEvent.keyDown(box(), { key: 'b', ctrlKey: true })
    expect(box().value).toBe('make **bold**')
    expect([box().selectionStart, box().selectionEnd]).toEqual([7, 11])

    fireEvent.keyDown(box(), { key: 'i', ctrlKey: true })
    expect(box().value).toBe('make **_bold_**')
  })

  it('strikes through with Ctrl+Shift+X and marks code with Ctrl+E', () => {
    render(<Harness initial="old new" />)
    caretAt(0, 3)
    fireEvent.keyDown(box(), { key: 'X', ctrlKey: true, shiftKey: true })
    expect(box().value).toBe('~~old~~ new')

    caretAt(8, 11)
    fireEvent.keyDown(box(), { key: 'e', ctrlKey: true })
    expect(box().value).toBe('~~old~~ `new`')
  })

  it('indents with Tab and outdents with Shift+Tab instead of leaving the box', () => {
    render(<Harness initial="- a" />)
    caretAt(3)

    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(false)
    expect(box().value).toBe('  - a')

    fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true })
    expect(box().value).toBe('- a')
  })
})
