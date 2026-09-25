import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore, type ActiveView } from '../store/appStore'
import { useCollab } from '../context/CollabContext'
import type { PeerViewMessage, PeerCursorMessage } from '../../../shared/collabProtocol'
import { peerPresenceColor } from '../../../shared/collabProtocol'

export interface PeerPresenceState {
  peerId: string
  view: string
  wallId?: string
  name: string
  color: string
  lastSeen: number
}

export function useCollabFollow() {
  const activeView = useAppStore(s => s.activeView)
  const setView = useAppStore(s => s.setView)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const collab = useCollab()

  const [peersMap, setPeersMap] = useState<Map<string, PeerPresenceState>>(() => new Map())
  const [followingPeerId, setFollowingPeerId] = useState<string | null>(null)
  const [followingPeerName, setFollowingPeerName] = useState<string | null>(null)

  const myName = collab.displayName || collab.osUserName || 'Anonymous'

  const broadcastMyView = useCallback(() => {
    if (!collab.active) return
    window.dispatchEvent(
      new CustomEvent('collab-my-view', {
        detail: {
          view: activeView,
          name: myName
        }
      })
    )
  }, [activeView, collab.active, myName])

  // Broadcast own view whenever activeView or activeWorkspace changes, or collab is active
  useEffect(() => {
    broadcastMyView()
  }, [broadcastMyView, activeWorkspace])

  // Periodic heartbeat every 4s to ensure late-joining or reconnecting peers stay in view sync
  useEffect(() => {
    if (!collab.active) return
    const timer = setInterval(() => {
      broadcastMyView()
    }, 4000)
    return () => clearInterval(timer)
  }, [broadcastMyView, collab.active])

  const findPeer = useCallback((idOrName: string, name?: string): PeerPresenceState | undefined => {
    if (peersMap.has(idOrName)) return peersMap.get(idOrName)
    for (const p of peersMap.values()) {
      if (p.peerId === idOrName) return p
      if (name && p.name.trim().toLowerCase() === name.trim().toLowerCase()) return p
      if (p.name.trim().toLowerCase() === idOrName.trim().toLowerCase()) return p
    }
    return undefined
  }, [peersMap])

  const stopFollowing = useCallback(() => {
    setFollowingPeerId(null)
    setFollowingPeerName(null)
    window.dispatchEvent(
      new CustomEvent('collab-following-changed', {
        detail: { followingPeerId: null, name: null }
      })
    )
  }, [])

  const startFollowing = useCallback((peerId: string, name?: string) => {
    const peer = findPeer(peerId, name)
    const effectiveId = peer?.peerId || peerId
    const effectiveName = peer?.name || name || null
    setFollowingPeerId(effectiveId)
    setFollowingPeerName(effectiveName)

    window.dispatchEvent(
      new CustomEvent('collab-following-changed', {
        detail: { followingPeerId: effectiveId, name: effectiveName }
      })
    )

    // Navigate to peer's view immediately
    const targetView = peer?.view
    if (targetView && targetView !== activeView) {
      setView(targetView as ActiveView)
    } else if (!targetView) {
      // If peer view not yet received and user is in kanban, switch to wall
      if (activeView === 'kanban') {
        setView('wall')
      }
    }
    window.dispatchEvent(new CustomEvent('collab-request-view'))
  }, [findPeer, activeView, setView])

  const jumpToPeer = useCallback((peerId: string, name?: string) => {
    const peer = findPeer(peerId, name)
    const targetView = peer?.view
    if (targetView && targetView !== activeView) {
      setView(targetView as ActiveView)
    } else if (!targetView) {
      if (activeView === 'kanban') {
        setView('wall')
      }
    }
    window.dispatchEvent(new CustomEvent('collab-request-view'))
  }, [findPeer, activeView, setView])

  // Listen to remote view and presence updates
  useEffect(() => {
    const handlePeerView = (e: Event) => {
      const detail = (e as CustomEvent<PeerViewMessage>).detail
      if (!detail || !detail.peerId || !detail.view) return

      setPeersMap(prev => {
        const next = new Map(prev)
        next.set(detail.peerId, {
          peerId: detail.peerId,
          view: detail.view,
          wallId: detail.wallId,
          name: detail.name || 'Anonymous',
          color: detail.color || peerPresenceColor(detail.peerId),
          lastSeen: Date.now()
        })
        return next
      })

      // If currently following this peer (by ID or name), follow their view transition!
      const isTargetPeer = followingPeerId === detail.peerId ||
        (Boolean(followingPeerName) && detail.name && detail.name.trim().toLowerCase() === followingPeerName?.trim().toLowerCase())

      if (isTargetPeer) {
        if (detail.view !== activeView) {
          setView(detail.view as ActiveView)
        }
      }
    }

    const handlePeerCursor = (e: Event) => {
      const detail = (e as CustomEvent<PeerCursorMessage>).detail
      if (!detail || !detail.peerId) return

      const view = detail.view || 'wall'
      setPeersMap(prev => {
        const next = new Map(prev)
        const existing = next.get(detail.peerId)
        next.set(detail.peerId, {
          peerId: detail.peerId,
          view,
          wallId: detail.wallId || existing?.wallId,
          name: detail.name || existing?.name || 'Anonymous',
          color: detail.color || existing?.color || peerPresenceColor(detail.peerId),
          lastSeen: Date.now()
        })
        return next
      })

      const isTargetPeer = followingPeerId === detail.peerId ||
        (Boolean(followingPeerName) && detail.name && detail.name.trim().toLowerCase() === followingPeerName?.trim().toLowerCase())

      if (isTargetPeer && activeView !== view) {
        setView(view as ActiveView)
      }
    }

    const handlePeerLeft = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string }>).detail
      if (!detail?.peerId) return

      if (detail.peerId === followingPeerId) {
        stopFollowing()
      }

      setPeersMap(prev => {
        if (!prev.has(detail.peerId)) return prev
        const next = new Map(prev)
        next.delete(detail.peerId)
        return next
      })
    }

    const handlePresenceClear = () => {
      stopFollowing()
      setPeersMap(new Map())
    }

    const handleFollowEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string; name?: string }>).detail
      if (!detail?.peerId) return
      const isAlreadyFollowing = followingPeerId === detail.peerId ||
        (Boolean(followingPeerName) && detail.name && detail.name.trim().toLowerCase() === followingPeerName?.trim().toLowerCase())

      if (isAlreadyFollowing) {
        stopFollowing()
      } else {
        startFollowing(detail.peerId, detail.name)
      }
    }

    const handleJumpEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string; name?: string }>).detail
      if (!detail?.peerId) return
      jumpToPeer(detail.peerId, detail.name)
    }

    const handleStopFollowEvent = () => {
      stopFollowing()
    }

    const handleRequestView = () => {
      broadcastMyView()
    }

    window.addEventListener('collab-peer-view', handlePeerView)
    window.addEventListener('collab-peer-cursor', handlePeerCursor)
    window.addEventListener('collab-peer-left', handlePeerLeft)
    window.addEventListener('collab-presence-clear', handlePresenceClear)
    window.addEventListener('collab-follow-peer', handleFollowEvent)
    window.addEventListener('collab-jump-to-peer', handleJumpEvent)
    window.addEventListener('collab-stop-follow', handleStopFollowEvent)
    window.addEventListener('collab-stop-following', handleStopFollowEvent)
    window.addEventListener('collab-request-view', handleRequestView)

    return () => {
      window.removeEventListener('collab-peer-view', handlePeerView)
      window.removeEventListener('collab-peer-cursor', handlePeerCursor)
      window.removeEventListener('collab-peer-left', handlePeerLeft)
      window.removeEventListener('collab-presence-clear', handlePresenceClear)
      window.removeEventListener('collab-follow-peer', handleFollowEvent)
      window.removeEventListener('collab-jump-to-peer', handleJumpEvent)
      window.removeEventListener('collab-stop-follow', handleStopFollowEvent)
      window.removeEventListener('collab-stop-following', handleStopFollowEvent)
      window.removeEventListener('collab-request-view', handleRequestView)
    }
  }, [followingPeerId, followingPeerName, activeView, setView, startFollowing, stopFollowing, jumpToPeer, broadcastMyView])

  // Cancel follow on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && followingPeerId) {
        stopFollowing()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [followingPeerId, stopFollowing])

  const followingPeer = useMemo(() => {
    if (!followingPeerId) return null
    const direct = peersMap.get(followingPeerId)
    if (direct) return direct
    if (followingPeerName) {
      for (const p of peersMap.values()) {
        if (p.name.trim().toLowerCase() === followingPeerName.trim().toLowerCase()) return p
      }
      return {
        peerId: followingPeerId,
        view: activeView === 'kanban' ? 'wall' : 'kanban',
        name: followingPeerName,
        color: peerPresenceColor(followingPeerId),
        lastSeen: Date.now()
      }
    }
    return null
  }, [followingPeerId, followingPeerName, peersMap, activeView])

  return {
    peersMap,
    peers: peersMap,
    followingPeerId,
    followingPeer,
    startFollowing,
    stopFollowing,
    jumpToPeer
  }
}
