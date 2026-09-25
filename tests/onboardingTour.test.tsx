// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import OnboardingTour from '../src/renderer/src/components/OnboardingTour'

describe('OnboardingTour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('recognizes Ctrl+K with international layouts (code=KeyK) on the palette step', async () => {
    render(<OnboardingTour onCreateWorkspace={vi.fn()} onClose={vi.fn()} />)

    // Initially on welcome step
    expect(screen.getByText('Welcome to Checkpoint')).toBeTruthy()

    // Click Next to reach palette step
    const nextBtn = screen.getByRole('button', { name: /Show me around/i })
    act(() => {
      fireEvent.click(nextBtn)
    })

    expect(screen.getByRole('heading', { name: 'Try the command palette' })).toBeTruthy()
    expect(screen.getByText(/Waiting for the keystroke/i)).toBeTruthy()

    // Dispatch Ctrl+K with Greek layout: key is 'κ', code is 'KeyK'
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'κ',
          code: 'KeyK',
          ctrlKey: true,
          bubbles: true
        })
      )
    })

    // Should recognize the shortcut
    expect(screen.getByText(/That is how you reach anything/i)).toBeTruthy()

    // Advance timer past the 850ms transition
    act(() => {
      vi.advanceTimersByTime(900)
    })

    // Should have transitioned to workspace step
    expect(screen.getByText('What are you working on?')).toBeTruthy()
  })

  it('allows clicking the palette shortcut card to continue', () => {
    render(<OnboardingTour onCreateWorkspace={vi.fn()} onClose={vi.fn()} />)

    // Move to palette step
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Show me around/i }))
    })
    expect(screen.getByRole('heading', { name: 'Try the command palette' })).toBeTruthy()

    // Click the card
    const card = screen.getByRole('button', { name: /Try Ctrl \+ K/i })
    act(() => {
      fireEvent.click(card)
    })

    expect(screen.getByText(/That is how you reach anything/i)).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.getByText('What are you working on?')).toBeTruthy()
  })
})
