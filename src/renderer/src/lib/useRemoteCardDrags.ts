import { useEffect, useState } from 'react'
import type { PeerCardDragMessage } from '../../../shared/collabProtocol'
import { peerPresenceColor } from '../../../shared/collabProtocol'

export interface RemoteCardDrag {
  peerId: string
  cardId: string
  name: string
  color: string
  columnId?: string
  overCardId?: string
}

export function useRemoteCardDrags() {
  const [dragsMap, setDragsMap] = useState<Map<string, RemoteCardDrag>>(() => new Map())

  useEffect(() => {
    const handlePeerCardDrag = (e: Event) => {
      const detail = (e as CustomEvent<PeerCardDragMessage>).detail
      if (!detail || !detail.cardId) return

      setDragsMap(prev => {
        const next = new Map(prev)
        if (!detail.isDragging) {
          next.delete(detail.cardId)
        } else {
          next.set(detail.cardId, {
            peerId: detail.peerId,
            cardId: detail.cardId,
            name: detail.name || 'Collaborator',
            color: detail.color || peerPresenceColor(detail.peerId),
            columnId: detail.columnId,
            overCardId: detail.overCardId
          })
        }
        return next
      })
    }

    const handlePeerLeft = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string }>).detail
      if (!detail?.peerId) return
      setDragsMap(prev => {
        let changed = false
        const next = new Map(prev)
        for (const [cardId, drag] of next) {
          if (drag.peerId === detail.peerId) {
            next.delete(cardId)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

    const handlePresenceClear = () => {
      setDragsMap(new Map())
    }

    window.addEventListener('collab-peer-card-drag', handlePeerCardDrag)
    window.addEventListener('collab-peer-left', handlePeerLeft)
    window.addEventListener('collab-presence-clear', handlePresenceClear)

    return () => {
      window.removeEventListener('collab-peer-card-drag', handlePeerCardDrag)
      window.removeEventListener('collab-peer-left', handlePeerLeft)
      window.removeEventListener('collab-presence-clear', handlePresenceClear)
    }
  }, [])

  return dragsMap
}
