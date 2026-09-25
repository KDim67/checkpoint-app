// @vitest-environment jsdom
import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WallItemLayer from '../src/renderer/src/components/wall/WallItemLayer'
import type { WallItem } from '../src/shared/wallModel'

describe('WallItemLayer remote selection', () => {
  const dummyItem: WallItem = {
    id: 'note-1',
    kind: 'note',
    x: 50,
    y: 50,
    width: 200,
    height: 200,
    z: 0,
    text: 'Test note'
  }

  const defaultProps = {
    item: dummyItem,
    editing: false,
    connectable: false,
    showHandles: false,
    arrowTarget: false,
    arrowFrom: false,
    onTextChange: vi.fn(),
    onFinishEditing: vi.fn(),
    onFollowLink: vi.fn()
  }

  it('renders without remote selection badge when remoteSelectedBy is empty or undefined', () => {
    const { container } = render(<WallItemLayer {...defaultProps} />)
    expect(container.querySelector('[data-wall-remote-selection-badge]')).toBeNull()
  })

  it('renders colored outline and peer badge when remoteSelectedBy has peer', () => {
    const peers = [
      { peerId: 'peer-1', name: 'Maria', color: '#10b981' }
    ]

    const { container } = render(
      <WallItemLayer {...defaultProps} remoteSelectedBy={peers} />
    )

    const badge = container.querySelector('[data-wall-remote-selection-badge]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('Maria')

    const rootEl = container.querySelector('[data-wall-item="note-1"]') as HTMLElement
    expect(rootEl.style.outline).toContain('#10b981')
  })

  it('combines names when multiple peers select the same item', () => {
    const peers = [
      { peerId: 'peer-1', name: 'Maria', color: '#10b981' },
      { peerId: 'peer-2', name: 'Alex', color: '#3b82f6' }
    ]

    const { container } = render(
      <WallItemLayer {...defaultProps} remoteSelectedBy={peers} />
    )

    const badge = container.querySelector('[data-wall-remote-selection-badge]')
    expect(badge?.textContent).toBe('Maria, Alex')
  })
})
