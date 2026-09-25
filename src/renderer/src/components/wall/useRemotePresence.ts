import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PeerCursorMessage, PeerSelectionMessage } from '../../../../shared/collabProtocol'
import { peerPresenceColor } from '../../../../shared/collabProtocol'
import { cameraCentredOnPoint, type WallCamera } from '../../../../shared/wallModel'
import { paintWallCamera } from './wallPaint'
import type { RemoteCursor } from './WallRemotePresence'

export interface RemoteSelection {
  peerId: string
  wallId: string
  selectedIds: string[]
  name: string
  color: string
  lastSeen: number
}

export interface PeerItemSelection {
  peerId: string
  name: string
  color: string
}

interface UseRemotePresenceOptions {
  wallId: string
  myName?: string
  myColor?: string
  viewportRef?: React.RefObject<HTMLElement | null>
  camera?: WallCamera
  setCamera?: (cam: WallCamera) => void
  panCameraRef?: React.MutableRefObject<WallCamera | null>
  toast?: (msg: string) => void
  onSwitchWall?: (wallId: string) => void
}

export function useRemotePresence({
  wallId,
  myName,
  myColor,
  viewportRef,
  camera,
  setCamera,
  panCameraRef,
  toast,
  onSwitchWall
}: UseRemotePresenceOptions) {
  const [cursorsMap, setCursorsMap] = useState<Map<string, RemoteCursor>>(() => new Map())
  const [selectionsMap, setSelectionsMap] = useState<Map<string, RemoteSelection>>(() => new Map())
  const [followingPeerId, setFollowingPeerId] = useState<string | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    // When changing wall, flush cursors and selections for other walls
    setCursorsMap(prev => {
      const next = new Map<string, RemoteCursor>()
      for (const [id, c] of prev) {
        if (c.wallId === wallId) next.set(id, c)
      }
      return next
    })
    setSelectionsMap(prev => {
      const next = new Map<string, RemoteSelection>()
      for (const [id, s] of prev) {
        if (s.wallId === wallId) next.set(id, s)
      }
      return next
    })
  }, [wallId])

  const animateToPoint = useCallback((point: { x: number; y: number }, zoom?: number): boolean => {
    const viewport = viewportRef?.current
    if (!viewport || !setCamera) return false

    const rect = viewport.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false

    const currentCam = panCameraRef?.current ?? camera ?? { x: 0, y: 0, zoom: 1 }
    const targetZoom = zoom ?? currentCam.zoom
    const targetCam = cameraCentredOnPoint(point, { width: rect.width, height: rect.height }, targetZoom)

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    const startX = currentCam.x
    const startY = currentCam.y
    const startZoom = currentCam.zoom
    const startTime = performance.now()
    const DURATION = 380

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / DURATION)
      const ease = 1 - Math.pow(1 - progress, 3) // easeOutCubic

      const nextCam: WallCamera = {
        x: startX + (targetCam.x - startX) * ease,
        y: startY + (targetCam.y - startY) * ease,
        zoom: startZoom + (targetCam.zoom - startZoom) * ease
      }

      paintWallCamera(viewport, nextCam)
      if (panCameraRef) panCameraRef.current = nextCam

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step)
      } else {
        animationFrameRef.current = null
        setCamera(targetCam)
      }
    }

    animationFrameRef.current = requestAnimationFrame(step)
    return true
  }, [viewportRef, setCamera, panCameraRef, camera])

  const jumpToPeer = useCallback((peerId: string): boolean => {
    const target = cursorsMap.get(peerId)
    if (!target) {
      toast?.('Collaborator has not moved on the Wall yet.')
      return false
    }

    if (target.wallId !== wallId && onSwitchWall) {
      onSwitchWall(target.wallId)
    }

    return animateToPoint({ x: target.x, y: target.y })
  }, [cursorsMap, wallId, onSwitchWall, animateToPoint, toast])

  const startFollowing = useCallback((peerId: string) => {
    setFollowingPeerId(peerId)
    jumpToPeer(peerId)
  }, [jumpToPeer])

  const stopFollowing = useCallback(() => {
    setFollowingPeerId(null)
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    const handlePeerCursor = (event: Event) => {
      const detail = (event as CustomEvent<PeerCursorMessage>).detail
      if (!detail || detail.wallId !== wallId) return

      setCursorsMap(prev => {
        const next = new Map(prev)
        next.set(detail.peerId, {
          peerId: detail.peerId,
          wallId: detail.wallId,
          x: detail.x,
          y: detail.y,
          name: detail.name || 'Anonymous',
          color: detail.color || peerPresenceColor(detail.peerId),
          lastSeen: Date.now()
        })
        return next
      })
    }

    const handlePeerSelection = (event: Event) => {
      const detail = (event as CustomEvent<PeerSelectionMessage>).detail
      if (!detail || detail.wallId !== wallId) return

      setSelectionsMap(prev => {
        const next = new Map(prev)
        if (!detail.selectedIds || detail.selectedIds.length === 0) {
          next.delete(detail.peerId)
        } else {
          next.set(detail.peerId, {
            peerId: detail.peerId,
            wallId: detail.wallId,
            selectedIds: detail.selectedIds,
            name: detail.name || 'Anonymous',
            color: detail.color || peerPresenceColor(detail.peerId),
            lastSeen: Date.now()
          })
        }
        return next
      })
    }

    const handlePeerLeft = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId: string }>).detail
      if (!detail?.peerId) return

      if (detail.peerId === followingPeerId) {
        setFollowingPeerId(null)
      }

      setCursorsMap(prev => {
        if (!prev.has(detail.peerId)) return prev
        const next = new Map(prev)
        next.delete(detail.peerId)
        return next
      })
      setSelectionsMap(prev => {
        if (!prev.has(detail.peerId)) return prev
        const next = new Map(prev)
        next.delete(detail.peerId)
        return next
      })
    }

    const handlePresenceClear = () => {
      setFollowingPeerId(null)
      setCursorsMap(new Map())
      setSelectionsMap(new Map())
    }

    const handleJumpEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId: string }>).detail
      if (detail?.peerId) jumpToPeer(detail.peerId)
    }

    const handleFollowEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId: string }>).detail
      if (detail?.peerId) {
        if (followingPeerId === detail.peerId) {
          stopFollowing()
        } else {
          startFollowing(detail.peerId)
        }
      }
    }

    const handleStopFollowEvent = () => {
      stopFollowing()
    }

    const handleFollowingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ followingPeerId: string | null }>).detail
      if (detail && detail.followingPeerId !== followingPeerId) {
        setFollowingPeerId(detail.followingPeerId)
        if (detail.followingPeerId) {
          jumpToPeer(detail.followingPeerId)
        }
      }
    }

    window.addEventListener('collab-peer-cursor', handlePeerCursor)
    window.addEventListener('collab-peer-selection', handlePeerSelection)
    window.addEventListener('collab-peer-left', handlePeerLeft)
    window.addEventListener('collab-presence-clear', handlePresenceClear)
    window.addEventListener('collab-jump-to-peer', handleJumpEvent)
    window.addEventListener('collab-follow-peer', handleFollowEvent)
    window.addEventListener('collab-stop-follow', handleStopFollowEvent)
    window.addEventListener('collab-following-changed', handleFollowingChanged)

    return () => {
      window.removeEventListener('collab-peer-cursor', handlePeerCursor)
      window.removeEventListener('collab-peer-selection', handlePeerSelection)
      window.removeEventListener('collab-peer-left', handlePeerLeft)
      window.removeEventListener('collab-presence-clear', handlePresenceClear)
      window.removeEventListener('collab-jump-to-peer', handleJumpEvent)
      window.removeEventListener('collab-follow-peer', handleFollowEvent)
      window.removeEventListener('collab-stop-follow', handleStopFollowEvent)
      window.removeEventListener('collab-following-changed', handleFollowingChanged)
    }
  }, [wallId, followingPeerId, jumpToPeer, startFollowing, stopFollowing])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('collab-following-changed', {
        detail: { followingPeerId }
      })
    )
  }, [followingPeerId])

  // Inactivity pruning: purge cursors not heard from for > 4000ms
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const STALE_MS = 4000

      setCursorsMap(prev => {
        let changed = false
        const next = new Map(prev)
        for (const [id, cursor] of next) {
          if (now - cursor.lastSeen > STALE_MS) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Cancel follow on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopFollowing()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [stopFollowing])

  const broadcastCursor = useCallback((x: number, y: number) => {
    window.dispatchEvent(
      new CustomEvent('collab-my-cursor', {
        detail: {
          wallId,
          x,
          y,
          name: myName,
          color: myColor
        }
      })
    )
  }, [wallId, myName, myColor])

  const broadcastSelection = useCallback((selectedIds: string[]) => {
    window.dispatchEvent(
      new CustomEvent('collab-my-selection', {
        detail: {
          wallId,
          selectedIds,
          name: myName,
          color: myColor
        }
      })
    )
  }, [wallId, myName, myColor])

  const cursors = useMemo(() => Array.from(cursorsMap.values()), [cursorsMap])
  const selections = useMemo(() => Array.from(selectionsMap.values()), [selectionsMap])

  const followingPeer = useMemo(() => {
    if (!followingPeerId) return null
    return cursorsMap.get(followingPeerId) ?? null
  }, [followingPeerId, cursorsMap])

  const followTargetX = followingPeer?.x
  const followTargetY = followingPeer?.y

  // Auto-follow: camera smoothly follows peer cursor updates
  useEffect(() => {
    if (followTargetX === undefined || followTargetY === undefined) return
    animateToPoint({ x: followTargetX, y: followTargetY })
  }, [followTargetX, followTargetY, animateToPoint])

  // Map of itemId -> Array of peers who have it selected
  const peerSelectedMap = useMemo(() => {
    const map = new Map<string, PeerItemSelection[]>()
    for (const sel of selections) {
      for (const id of sel.selectedIds) {
        const list = map.get(id) ?? []
        list.push({
          peerId: sel.peerId,
          name: sel.name,
          color: sel.color
        })
        map.set(id, list)
      }
    }
    return map
  }, [selections])

  return {
    cursors,
    selections,
    peerSelectedMap,
    followingPeerId,
    followingPeer,
    jumpToPeer,
    startFollowing,
    stopFollowing,
    broadcastCursor,
    broadcastSelection
  }
}
