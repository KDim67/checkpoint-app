// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRemoteCardDrags } from '../src/renderer/src/lib/useRemoteCardDrags'
import type { PeerCardDragMessage, PeerLiveMoveMessage } from '../src/shared/collabProtocol'

describe('Live Movement Previews', () => {
  describe('Kanban useRemoteCardDrags', () => {
    it('initializes with empty drags map', () => {
      const { result } = renderHook(() => useRemoteCardDrags())
      expect(result.current.size).toBe(0)
    })

    it('adds and updates active remote card drags', () => {
      const { result } = renderHook(() => useRemoteCardDrags())

      // 1. Peer starts dragging card-1
      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-card-drag', {
            detail: {
              type: 'peer-card-drag',
              context: 'ws',
              peerId: 'peer-alice',
              cardId: 'card-1',
              isDragging: true,
              columnId: 'in_progress',
              overCardId: 'card-2',
              name: 'Alice',
              color: '#10b981'
            } as PeerCardDragMessage
          })
        )
      })

      expect(result.current.size).toBe(1)
      const drag = result.current.get('card-1')
      expect(drag).toBeDefined()
      expect(drag?.peerId).toBe('peer-alice')
      expect(drag?.name).toBe('Alice')
      expect(drag?.color).toBe('#10b981')
      expect(drag?.columnId).toBe('in_progress')
      expect(drag?.overCardId).toBe('card-2')

      // 2. Peer moves over another card in column 'done'
      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-card-drag', {
            detail: {
              type: 'peer-card-drag',
              context: 'ws',
              peerId: 'peer-alice',
              cardId: 'card-1',
              isDragging: true,
              columnId: 'done',
              overCardId: undefined,
              name: 'Alice',
              color: '#10b981'
            } as PeerCardDragMessage
          })
        )
      })

      expect(result.current.size).toBe(1)
      expect(result.current.get('card-1')?.columnId).toBe('done')
      expect(result.current.get('card-1')?.overCardId).toBeUndefined()

      // 3. Peer ends drag
      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-card-drag', {
            detail: {
              type: 'peer-card-drag',
              context: 'ws',
              peerId: 'peer-alice',
              cardId: 'card-1',
              isDragging: false
            } as PeerCardDragMessage
          })
        )
      })

      expect(result.current.size).toBe(0)
    })

    it('clears drags when peer disconnects or on presence clear', () => {
      const { result } = renderHook(() => useRemoteCardDrags())

      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-card-drag', {
            detail: {
              type: 'peer-card-drag',
              context: 'ws',
              peerId: 'peer-bob',
              cardId: 'card-42',
              isDragging: true,
              name: 'Bob'
            } as PeerCardDragMessage
          })
        )
      })

      expect(result.current.size).toBe(1)

      // Bob leaves
      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-left', {
            detail: { peerId: 'peer-bob' }
          })
        )
      })

      expect(result.current.size).toBe(0)

      // Test presence clear
      act(() => {
        window.dispatchEvent(
          new CustomEvent('collab-peer-card-drag', {
            detail: {
              type: 'peer-card-drag',
              context: 'ws',
              peerId: 'peer-carol',
              cardId: 'card-99',
              isDragging: true,
              name: 'Carol'
            } as PeerCardDragMessage
          })
        )
      })

      expect(result.current.size).toBe(1)

      act(() => {
        window.dispatchEvent(new CustomEvent('collab-presence-clear'))
      })

      expect(result.current.size).toBe(0)
    })
  })

  describe('Wall live movement protocol payload', () => {
    it('dispatches and formats peer live move messages correctly', () => {
      let receivedDetail: PeerLiveMoveMessage | null = null
      const listener = (e: Event) => {
        receivedDetail = (e as CustomEvent<PeerLiveMoveMessage>).detail
      }

      window.addEventListener('collab-peer-live-move', listener)

      const liveMove: PeerLiveMoveMessage = {
        type: 'peer-live-move',
        context: 'ws',
        wallId: 'wall-10',
        peerId: 'peer-dave',
        items: [
          { id: 'sticky-1', x: 150, y: 220 },
          { id: 'sticky-2', x: 400, y: 300 }
        ],
        name: 'Dave',
        color: '#f97316'
      }

      window.dispatchEvent(new CustomEvent('collab-peer-live-move', { detail: liveMove }))

      expect(receivedDetail).toEqual(liveMove)
      const detail = receivedDetail as PeerLiveMoveMessage | null
      expect(detail?.items).toHaveLength(2)
      expect(detail?.items[0].x).toBe(150)
      expect(detail?.items[0].y).toBe(220)

      window.removeEventListener('collab-peer-live-move', listener)
    })
  })
})
