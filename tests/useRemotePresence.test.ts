// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemotePresence } from '../src/renderer/src/components/wall/useRemotePresence'
import type { PeerCursorMessage, PeerSelectionMessage } from '../src/shared/collabProtocol'

describe('useRemotePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with empty cursors and selections', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    expect(result.current.cursors).toEqual([])
    expect(result.current.selections).toEqual([])
    expect(result.current.peerSelectedMap.size).toBe(0)
  })

  it('receives peer cursor events and tracks them for the active wall', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    const cursorMsg: PeerCursorMessage = {
      type: 'peer-cursor',
      context: 'ws',
      wallId: 'wall-1',
      peerId: 'peer-bob',
      x: 320,
      y: 180,
      name: 'Bob',
      color: '#06b6d4'
    }

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', { detail: cursorMsg }))
    })

    expect(result.current.cursors).toHaveLength(1)
    expect(result.current.cursors[0]).toMatchObject({
      peerId: 'peer-bob',
      wallId: 'wall-1',
      x: 320,
      y: 180,
      name: 'Bob',
      color: '#06b6d4'
    })
  })

  it('ignores peer cursors for other walls', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    const otherWallMsg: PeerCursorMessage = {
      type: 'peer-cursor',
      context: 'ws',
      wallId: 'wall-other',
      peerId: 'peer-charlie',
      x: 50,
      y: 50,
      name: 'Charlie',
      color: '#8b5cf6'
    }

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', { detail: otherWallMsg }))
    })

    expect(result.current.cursors).toHaveLength(0)
  })

  it('tracks peer selections and maps selected items', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    const selectionMsg: PeerSelectionMessage = {
      type: 'peer-selection',
      context: 'ws',
      wallId: 'wall-1',
      peerId: 'peer-bob',
      selectedIds: ['card-1', 'note-2'],
      name: 'Bob',
      color: '#06b6d4'
    }

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-selection', { detail: selectionMsg }))
    })

    expect(result.current.selections).toHaveLength(1)
    expect(result.current.peerSelectedMap.has('card-1')).toBe(true)
    expect(result.current.peerSelectedMap.get('card-1')).toEqual([
      { peerId: 'peer-bob', name: 'Bob', color: '#06b6d4' }
    ])
    expect(result.current.peerSelectedMap.get('note-2')).toEqual([
      { peerId: 'peer-bob', name: 'Bob', color: '#06b6d4' }
    ])
    expect(result.current.peerSelectedMap.has('other-item')).toBe(false)
  })

  it('handles multiple peers selecting the same item', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-selection', {
        detail: {
          type: 'peer-selection',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-bob',
          selectedIds: ['card-1'],
          name: 'Bob',
          color: '#06b6d4'
        }
      }))
      window.dispatchEvent(new CustomEvent('collab-peer-selection', {
        detail: {
          type: 'peer-selection',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-charlie',
          selectedIds: ['card-1', 'card-2'],
          name: 'Charlie',
          color: '#8b5cf6'
        }
      }))
    })

    const card1Peers = result.current.peerSelectedMap.get('card-1')
    expect(card1Peers).toHaveLength(2)
    expect(card1Peers?.[0].name).toBe('Bob')
    expect(card1Peers?.[1].name).toBe('Charlie')
  })

  it('removes peer presence when collab-peer-left is dispatched', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', {
        detail: {
          type: 'peer-cursor',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-bob',
          x: 100,
          y: 100,
          name: 'Bob',
          color: '#06b6d4'
        }
      }))
      window.dispatchEvent(new CustomEvent('collab-peer-selection', {
        detail: {
          type: 'peer-selection',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-bob',
          selectedIds: ['note-1'],
          name: 'Bob',
          color: '#06b6d4'
        }
      }))
    })

    expect(result.current.cursors).toHaveLength(1)
    expect(result.current.peerSelectedMap.size).toBe(1)

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-left', { detail: { peerId: 'peer-bob' } }))
    })

    expect(result.current.cursors).toHaveLength(0)
    expect(result.current.peerSelectedMap.size).toBe(0)
  })

  it('clears all presence on collab-presence-clear', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', {
        detail: {
          type: 'peer-cursor',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-bob',
          x: 100,
          y: 100,
          name: 'Bob',
          color: '#06b6d4'
        }
      }))
    })

    expect(result.current.cursors).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-presence-clear'))
    })

    expect(result.current.cursors).toHaveLength(0)
    expect(result.current.selections).toHaveLength(0)
  })

  it('prunes inactive cursors after 4 seconds', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', {
        detail: {
          type: 'peer-cursor',
          context: 'ws',
          wallId: 'wall-1',
          peerId: 'peer-bob',
          x: 100,
          y: 100,
          name: 'Bob',
          color: '#06b6d4'
        }
      }))
    })

    expect(result.current.cursors).toHaveLength(1)

    // Advance timers by 4.5 seconds
    act(() => {
      vi.advanceTimersByTime(4500)
      vi.setSystemTime(Date.now() + 4500)
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.cursors).toHaveLength(0)
  })

  it('dispatches local cursor and selection broadcast events', () => {
    const onLocalCursor = vi.fn()
    const onLocalSelection = vi.fn()
    window.addEventListener('collab-my-cursor', onLocalCursor)
    window.addEventListener('collab-my-selection', onLocalSelection)

    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-1', myName: 'Alice' }))

    act(() => {
      result.current.broadcastCursor(240, 480)
    })

    expect(onLocalCursor).toHaveBeenCalledTimes(1)
    const cursorEvent = onLocalCursor.mock.calls[0][0] as CustomEvent
    expect(cursorEvent.detail).toMatchObject({
      wallId: 'wall-1',
      x: 240,
      y: 480,
      name: 'Alice'
    })

    act(() => {
      result.current.broadcastSelection(['card-99'])
    })

    expect(onLocalSelection).toHaveBeenCalledTimes(1)
    const selectionEvent = onLocalSelection.mock.calls[0][0] as CustomEvent
    expect(selectionEvent.detail).toMatchObject({
      wallId: 'wall-1',
      selectedIds: ['card-99'],
      name: 'Alice'
    })

    window.removeEventListener('collab-my-cursor', onLocalCursor)
    window.removeEventListener('collab-my-selection', onLocalSelection)
  })
})
