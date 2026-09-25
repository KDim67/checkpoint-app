// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCollabFollow } from '../src/renderer/src/lib/useCollabFollow'
import type { PeerViewMessage } from '../src/shared/collabProtocol'

const mockSetView = vi.fn()
let currentMockView = 'kanban'

interface MockAppState {
  activeView: string
  setView: (v: string) => void
  activeWorkspace: string
}

vi.mock('../src/renderer/src/store/appStore', () => ({
  useAppStore: <T>(selector: (s: MockAppState) => T): T => {
    const state: MockAppState = {
      activeView: currentMockView,
      setView: (v: string) => {
        currentMockView = v
        mockSetView(v)
      },
      activeWorkspace: 'default'
    }
    return selector(state)
  }
}))

vi.mock('../src/renderer/src/context/CollabContext', () => ({
  useCollab: () => ({
    active: true,
    displayName: 'Alice',
    osUserName: 'alice'
  })
}))

describe('Cross-View Auto-Follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentMockView = 'kanban'
  })

  afterEach(() => {
    window.dispatchEvent(new CustomEvent('collab-presence-clear'))
  })

  it('tracks peer view announcements and navigates immediately upon follow', () => {
    const { result } = renderHook(() => useCollabFollow())

    // 1. Peer Bob announces view 'wall'
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'wall',
            name: 'Bob',
            color: '#3b82f6'
          } as PeerViewMessage
        })
      )
    })

    expect(result.current.peers.has('peer-bob')).toBe(true)
    expect(result.current.peers.get('peer-bob')?.view).toBe('wall')

    // 2. Start following Bob -> should trigger setView('wall')
    act(() => {
      result.current.startFollowing('peer-bob')
    })

    expect(result.current.followingPeerId).toBe('peer-bob')
    expect(result.current.followingPeer?.name).toBe('Bob')
    expect(mockSetView).toHaveBeenCalledWith('wall')
  })

  it('auto-switches view when the followed peer transitions between views', () => {
    const { result } = renderHook(() => useCollabFollow())

    // Peer Bob on wall
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'wall',
            name: 'Bob',
            color: '#3b82f6'
          } as PeerViewMessage
        })
      )
    })

    // Follow Bob
    act(() => {
      result.current.startFollowing('peer-bob')
    })

    expect(mockSetView).toHaveBeenCalledWith('wall')
    currentMockView = 'wall'
    mockSetView.mockClear()

    // Bob now switches back to kanban
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'kanban',
            name: 'Bob',
            color: '#3b82f6'
          } as PeerViewMessage
        })
      )
    })

    expect(mockSetView).toHaveBeenCalledWith('kanban')
  })

  it('supports jumpToPeer without continuously following', () => {
    const { result } = renderHook(() => useCollabFollow())

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'wall',
            name: 'Bob',
            color: '#3b82f6'
          } as PeerViewMessage
        })
      )
    })

    // Jump to Bob
    act(() => {
      result.current.jumpToPeer('peer-bob')
    })

    expect(mockSetView).toHaveBeenCalledWith('wall')
    expect(result.current.followingPeerId).toBeNull()
  })

  it('stops following on Escape key', () => {
    const { result } = renderHook(() => useCollabFollow())

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'wall',
            name: 'Bob'
          } as PeerViewMessage
        })
      )
    })

    act(() => {
      result.current.startFollowing('peer-bob')
    })
    expect(result.current.followingPeerId).toBe('peer-bob')

    // Press Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.followingPeerId).toBeNull()
  })

  it('stops following when the followed peer disconnects', () => {
    const { result } = renderHook(() => useCollabFollow())

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-bob',
            view: 'wall',
            name: 'Bob'
          } as PeerViewMessage
        })
      )
    })

    act(() => {
      result.current.startFollowing('peer-bob')
    })
    expect(result.current.followingPeerId).toBe('peer-bob')

    // Bob leaves
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-left', {
          detail: { peerId: 'peer-bob' }
        })
      )
    })

    expect(result.current.followingPeerId).toBeNull()
    expect(result.current.peers.has('peer-bob')).toBe(false)
  })

  it('responds to global collab-follow-peer and collab-stop-following events', () => {
    const { result } = renderHook(() => useCollabFollow())

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-view', {
          detail: {
            type: 'peer-view',
            context: 'ws',
            peerId: 'peer-charlie',
            view: 'wall',
            name: 'Charlie'
          } as PeerViewMessage
        })
      )
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-follow-peer', {
          detail: { peerId: 'peer-charlie' }
        })
      )
    })

    expect(result.current.followingPeerId).toBe('peer-charlie')

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-stop-following'))
    })

    expect(result.current.followingPeerId).toBeNull()
  })
})
