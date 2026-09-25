// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemotePresence } from '../src/renderer/src/components/wall/useRemotePresence'
import type { PeerCursorMessage } from '../src/shared/collabProtocol'

describe('Collaborator Jump and Auto-Follow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks followingPeer and updates target position when followed peer moves', () => {
    const { result } = renderHook(() =>
      useRemotePresence({
        wallId: 'wall-main',
        myName: 'Local User'
      })
    )

    // 1. Peer appears on wall
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-bob',
            x: 200,
            y: 300,
            name: 'Bob',
            color: '#06b6d4'
          } as PeerCursorMessage
        })
      )
    })

    expect(result.current.cursors).toHaveLength(1)
    expect(result.current.followingPeer).toBeNull()

    // 2. Start following Bob
    act(() => {
      result.current.startFollowing('peer-bob')
    })

    expect(result.current.followingPeerId).toBe('peer-bob')
    expect(result.current.followingPeer?.name).toBe('Bob')
    expect(result.current.followingPeer?.x).toBe(200)
    expect(result.current.followingPeer?.y).toBe(300)

    // 3. Bob moves to a new position
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-bob',
            x: 500,
            y: 700,
            name: 'Bob',
            color: '#06b6d4'
          } as PeerCursorMessage
        })
      )
    })

    expect(result.current.followingPeer?.x).toBe(500)
    expect(result.current.followingPeer?.y).toBe(700)

    // 4. Stop following
    act(() => {
      result.current.stopFollowing()
    })

    expect(result.current.followingPeerId).toBeNull()
    expect(result.current.followingPeer).toBeNull()
  })

  it('stops following if the followed peer leaves the room', () => {
    const { result } = renderHook(() =>
      useRemotePresence({
        wallId: 'wall-main',
        myName: 'Local User'
      })
    )

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-bob',
            x: 100,
            y: 100,
            name: 'Bob',
            color: '#06b6d4'
          } as PeerCursorMessage
        })
      )
      result.current.startFollowing('peer-bob')
    })

    expect(result.current.followingPeerId).toBe('peer-bob')

    // Peer leaves
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-left', {
          detail: { peerId: 'peer-bob' }
        })
      )
    })

    expect(result.current.followingPeerId).toBeNull()
    expect(result.current.followingPeer).toBeNull()
  })

  it('listens to collab-jump-to-peer and collab-follow-peer window events', () => {
    const { result } = renderHook(() =>
      useRemotePresence({
        wallId: 'wall-main',
        myName: 'Local User'
      })
    )

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-elena',
            x: 400,
            y: 400,
            name: 'Elena',
            color: '#f43f5e'
          } as PeerCursorMessage
        })
      )
    })

    // Follow via window event
    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-follow-peer', {
          detail: { peerId: 'peer-elena' }
        })
      )
    })

    expect(result.current.followingPeerId).toBe('peer-elena')
    expect(result.current.followingPeer?.name).toBe('Elena')

    // Stop follow via window event
    act(() => {
      window.dispatchEvent(new CustomEvent('collab-stop-follow'))
    })

    expect(result.current.followingPeerId).toBeNull()
    expect(result.current.followingPeer).toBeNull()
  })

  it('cancels auto-following when Escape key is pressed', () => {
    const { result } = renderHook(() =>
      useRemotePresence({
        wallId: 'wall-main',
        myName: 'Local User'
      })
    )

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-elena',
            x: 400,
            y: 400,
            name: 'Elena',
            color: '#f43f5e'
          } as PeerCursorMessage
        })
      )
      result.current.startFollowing('peer-elena')
    })

    expect(result.current.followingPeerId).toBe('peer-elena')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.followingPeerId).toBeNull()
    expect(result.current.followingPeer).toBeNull()
  })

  it('broadcasts collab-following-changed event on state change', () => {
    const followingChangedListener = vi.fn()
    window.addEventListener('collab-following-changed', followingChangedListener)

    const { result } = renderHook(() =>
      useRemotePresence({
        wallId: 'wall-main',
        myName: 'Local User'
      })
    )

    act(() => {
      window.dispatchEvent(
        new CustomEvent('collab-peer-cursor', {
          detail: {
            type: 'peer-cursor',
            context: 'ws',
            wallId: 'wall-main',
            peerId: 'peer-elena',
            x: 400,
            y: 400,
            name: 'Elena',
            color: '#f43f5e'
          } as PeerCursorMessage
        })
      )
      result.current.startFollowing('peer-elena')
    })

    expect(followingChangedListener).toHaveBeenCalled()
    const lastEvent = followingChangedListener.mock.calls[followingChangedListener.mock.calls.length - 1][0] as CustomEvent
    expect(lastEvent.detail.followingPeerId).toBe('peer-elena')

    window.removeEventListener('collab-following-changed', followingChangedListener)
  })
})
