// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WallPresenter from '../src/renderer/src/components/wall/WallPresenter'

afterEach(cleanup)

const button = (label: string): HTMLButtonElement => screen.getByLabelText(label) as HTMLButtonElement

describe('WallPresenter', () => {
  it('shows which frame is up, steps either way, and stops', () => {
    const onStep = vi.fn()
    const onExit = vi.fn()
    render(<WallPresenter index={0} count={3} label="Intro" onStep={onStep} onExit={onExit} />)

    expect(screen.getByText('Intro')).toBeTruthy()
    expect(screen.getByText('1 of 3')).toBeTruthy()
    expect(button('Previous frame').disabled).toBe(true)

    fireEvent.click(button('Next frame'))
    expect(onStep).toHaveBeenCalledWith(1)
    fireEvent.click(button('Stop presenting'))
    expect(onExit).toHaveBeenCalled()
  })

  it('has no next frame after the last one', () => {
    const onStep = vi.fn()
    render(<WallPresenter index={2} count={3} label="End" onStep={onStep} onExit={vi.fn()} />)

    expect(button('Next frame').disabled).toBe(true)
    fireEvent.click(button('Previous frame'))
    expect(onStep).toHaveBeenCalledWith(-1)
  })
})
