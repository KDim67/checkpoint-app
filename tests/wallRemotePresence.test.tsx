// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WallRemotePresence, { type RemoteCursor } from '../src/renderer/src/components/wall/WallRemotePresence'

describe('WallRemotePresence', () => {
  it('renders nothing when cursors array is empty', () => {
    const { container } = render(<WallRemotePresence cursors={[]} zoom={1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders cursors with peer name and color', () => {
    const cursors: RemoteCursor[] = [
      {
        peerId: 'peer-1',
        wallId: 'wall-1',
        x: 150,
        y: 200,
        name: 'Elena',
        color: '#f43f5e',
        lastSeen: Date.now()
      },
      {
        peerId: 'peer-2',
        wallId: 'wall-1',
        x: 400,
        y: 600,
        name: 'Nikos',
        color: '#06b6d4',
        lastSeen: Date.now()
      }
    ]

    render(<WallRemotePresence cursors={cursors} zoom={1} />)

    expect(screen.getByText('Elena')).toBeTruthy()
    expect(screen.getByText('Nikos')).toBeTruthy()

    const elenaBadge = screen.getByText('Elena').closest('[data-wall-remote-cursor]') as HTMLElement | null
    expect(elenaBadge).toBeTruthy()
    expect(elenaBadge?.style.transform).toContain('translate(150px, 200px)')
  })

  it('inverses zoom scaling so cursor retains constant size at different zooms', () => {
    const cursors: RemoteCursor[] = [
      {
        peerId: 'peer-1',
        wallId: 'wall-1',
        x: 100,
        y: 100,
        name: 'Elena',
        color: '#f43f5e',
        lastSeen: Date.now()
      }
    ]

    const { container, rerender } = render(<WallRemotePresence cursors={cursors} zoom={2} />)
    const innerScaler = container.querySelector('[data-wall-cursor-scaler]') as HTMLElement
    expect(innerScaler).toBeTruthy()
    expect(innerScaler.style.transform).toContain('scale(0.5)')

    rerender(<WallRemotePresence cursors={cursors} zoom={0.5} />)
    const updatedScaler = container.querySelector('[data-wall-cursor-scaler]') as HTMLElement
    expect(updatedScaler.style.transform).toContain('scale(2)')
  })
})
