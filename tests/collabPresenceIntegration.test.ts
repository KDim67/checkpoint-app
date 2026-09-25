// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemotePresence } from '../src/renderer/src/components/wall/useRemotePresence'
import { normalizeCollabMessage, peerPresenceColor, type PeerCursorMessage, type PeerSelectionMessage } from '../src/shared/collabProtocol'

describe('Collab Presence End-to-End Pipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes presence wire messages and feeds useRemotePresence hook', () => {
    const { result } = renderHook(() => useRemotePresence({ wallId: 'wall-main', myName: 'Local User' }))

    // 1. Simulating inbound network message serialized over WebRTC data channel
    const rawCursor = {
      type: 'peer-cursor',
      context: 'ws-team',
      wallId: 'wall-main',
      peerId: 'peer-dimitris',
      x: 520,
      y: 340,
      name: 'Dimitris',
      color: '#f43f5e'
    }

    const normalizedCursor = normalizeCollabMessage(JSON.parse(JSON.stringify(rawCursor))) as PeerCursorMessage
    expect(normalizedCursor).not.toBeNull()
    expect(normalizedCursor.type).toBe('peer-cursor')

    // 2. Dispatch the event as WebRTCCollaborationCoordinator does on receiving the message
    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', { detail: normalizedCursor }))
    })

    expect(result.current.cursors).toHaveLength(1)
    expect(result.current.cursors[0]).toMatchObject({
      peerId: 'peer-dimitris',
      wallId: 'wall-main',
      x: 520,
      y: 340,
      name: 'Dimitris',
      color: '#f43f5e'
    })

    // 3. Simulating inbound selection message
    const rawSelection = {
      type: 'peer-selection',
      context: 'ws-team',
      wallId: 'wall-main',
      peerId: 'peer-dimitris',
      selectedIds: ['card-alpha', 'note-beta'],
      name: 'Dimitris',
      color: '#f43f5e'
    }

    const normalizedSelection = normalizeCollabMessage(JSON.parse(JSON.stringify(rawSelection))) as PeerSelectionMessage
    expect(normalizedSelection).not.toBeNull()

    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-selection', { detail: normalizedSelection }))
    })

    expect(result.current.peerSelectedMap.has('card-alpha')).toBe(true)
    expect(result.current.peerSelectedMap.get('card-alpha')?.[0].name).toBe('Dimitris')
    expect(result.current.peerSelectedMap.has('note-beta')).toBe(true)

    // 4. Moving cursor updates position in-place
    const movedCursor = {
      ...rawCursor,
      x: 600,
      y: 400
    }
    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-cursor', { detail: movedCursor }))
    })

    expect(result.current.cursors).toHaveLength(1)
    expect(result.current.cursors[0].x).toBe(600)
    expect(result.current.cursors[0].y).toBe(400)

    // 5. Deselecting items clears them from peerSelectedMap
    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-selection', {
        detail: {
          ...rawSelection,
          selectedIds: []
        }
      }))
    })

    expect(result.current.peerSelectedMap.has('card-alpha')).toBe(false)
    expect(result.current.peerSelectedMap.has('note-beta')).toBe(false)

    // 6. Peer left clears their cursor
    act(() => {
      window.dispatchEvent(new CustomEvent('collab-peer-left', { detail: { peerId: 'peer-dimitris' } }))
    })

    expect(result.current.cursors).toHaveLength(0)
  })

  it('assigns deterministic colors to peers based on peerId', () => {
    const colorA = peerPresenceColor('peer-123')
    const colorB = peerPresenceColor('peer-123')
    const colorC = peerPresenceColor('peer-456')

    expect(colorA).toBe(colorB)
    expect(typeof colorA).toBe('string')
    expect(colorA.startsWith('#')).toBe(true)
    expect(typeof colorC).toBe('string')
  })
})
