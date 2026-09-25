// @vitest-environment jsdom
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import WallPresenceRoster from '../src/renderer/src/components/wall/WallPresenceRoster'

afterEach(cleanup)

describe('WallPresenceRoster', () => {
  const sampleMembers = [
    { id: 'peer-1', name: 'Alice' },
    { id: 'peer-2', name: 'Bob Smith' }
  ]

  it('renders nothing when roster is empty', () => {
    const { container } = render(
      <WallPresenceRoster
        members={[]}
        followingPeerId={null}
        onJumpTo={vi.fn()}
        onFollow={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders avatars with initials and tooltips for connected peers', () => {
    render(
      <WallPresenceRoster
        members={sampleMembers}
        followingPeerId={null}
        onJumpTo={vi.fn()}
        onFollow={vi.fn()}
      />
    )

    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('BS')).toBeTruthy()
    expect(screen.getByTitle(/Alice/)).toBeTruthy()
    expect(screen.getByTitle(/Bob Smith/)).toBeTruthy()
  })

  it('triggers onJumpTo on single click and onFollow on click', () => {
    const onJumpTo = vi.fn()
    const onFollow = vi.fn()

    render(
      <WallPresenceRoster
        members={sampleMembers}
        followingPeerId={null}
        onJumpTo={onJumpTo}
        onFollow={onFollow}
      />
    )

    const aliceBtn = screen.getByTitle(/Alice/)
    fireEvent.click(aliceBtn)

    expect(onJumpTo).toHaveBeenCalledWith('peer-1')
  })

  it('renders active following indicator when following a peer', () => {
    const { container } = render(
      <WallPresenceRoster
        members={sampleMembers}
        followingPeerId="peer-1"
        onJumpTo={vi.fn()}
        onFollow={vi.fn()}
      />
    )

    const activeEl = container.querySelector('[data-wall-avatar-following="true"]')
    expect(activeEl).toBeTruthy()
    expect(activeEl?.getAttribute('data-peer-id')).toBe('peer-1')
  })
})
