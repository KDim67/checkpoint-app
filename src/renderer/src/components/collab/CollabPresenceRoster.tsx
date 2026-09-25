import React, { useEffect, useState } from 'react'
import { peerPresenceColor } from '../../../../shared/collabProtocol'

export interface CollabPresenceMember {
  id: string
  name: string
}

export interface CollabPresenceRosterProps {
  members: CollabPresenceMember[]
  followingPeerId?: string | null
  onJumpTo?: (peerId: string) => void
  onFollow?: (peerId: string) => void
}

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase()
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function CollabPresenceRoster({
  members,
  followingPeerId,
  onJumpTo,
  onFollow
}: CollabPresenceRosterProps) {
  const [eventFollowingId, setEventFollowingId] = useState<string | null>(null)
  const [eventFollowingName, setEventFollowingName] = useState<string | null>(null)
  const [peerViews, setPeerViews] = useState<Record<string, string>>({})

  useEffect(() => {
    const handleFollowingChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ followingPeerId: string | null; name?: string | null }>).detail
      setEventFollowingId(detail?.followingPeerId ?? null)
      setEventFollowingName(detail?.name ?? null)
    }

    const handlePeerView = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string; view: string }>).detail
      if (detail?.peerId && detail?.view) {
        setPeerViews(prev => ({ ...prev, [detail.peerId]: detail.view }))
      }
    }

    const handlePeerCursor = (e: Event) => {
      const detail = (e as CustomEvent<{ peerId: string; view?: string }>).detail
      if (detail?.peerId) {
        setPeerViews(prev => ({ ...prev, [detail.peerId]: detail.view || 'wall' }))
      }
    }

    window.addEventListener('collab-following-changed', handleFollowingChanged)
    window.addEventListener('collab-peer-view', handlePeerView)
    window.addEventListener('collab-peer-cursor', handlePeerCursor)

    return () => {
      window.removeEventListener('collab-following-changed', handleFollowingChanged)
      window.removeEventListener('collab-peer-view', handlePeerView)
      window.removeEventListener('collab-peer-cursor', handlePeerCursor)
    }
  }, [])

  if (!members || members.length === 0) {
    return null
  }

  const currentFollowingId = followingPeerId !== undefined ? followingPeerId : eventFollowingId

  const handleJump = (peerId: string, name?: string) => {
    if (onJumpTo) {
      onJumpTo(peerId)
    } else {
      window.dispatchEvent(new CustomEvent('collab-jump-to-peer', { detail: { peerId, name } }))
    }
  }

  const handleFollow = (peerId: string, name?: string) => {
    if (onFollow) {
      onFollow(peerId)
    } else {
      window.dispatchEvent(new CustomEvent('collab-follow-peer', { detail: { peerId, name } }))
    }
  }

  return (
    <div
      className="wall-presence-roster collab-presence-roster"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 2px'
      }}
      aria-label="Collaborators on this board"
    >
      {members.map((member, idx) => {
        const isFollowing = currentFollowingId === member.id ||
          (Boolean(eventFollowingName) && Boolean(member.name) && eventFollowingName?.trim().toLowerCase() === member.name.trim().toLowerCase())
        const color = peerPresenceColor(member.id)
        const initials = getInitials(member.name)
        const viewName = peerViews[member.id]
          ? (peerViews[member.id] === 'wall' ? 'Wall' : peerViews[member.id] === 'kanban' ? 'Kanban' : peerViews[member.id])
          : null
        const locationStr = viewName ? ` (${viewName})` : ''
        const tooltip = isFollowing
          ? `${member.name}${locationStr} (Following · Click to Jump · Double-click to stop)`
          : `${member.name}${locationStr} (Click to Jump · Double-click to Auto-Follow)`

        return (
          <div
            key={member.id}
            style={{
              position: 'relative',
              marginLeft: idx === 0 ? 0 : '-6px',
              zIndex: isFollowing ? 20 : 10 - idx
            }}
          >
            <button
              type="button"
              title={tooltip}
              aria-label={tooltip}
              data-peer-id={member.id}
              data-wall-avatar-following={isFollowing ? 'true' : 'false'}
              onClick={() => handleJump(member.id, member.name)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                handleFollow(member.id, member.name)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: color,
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 700,
                border: isFollowing ? '2px solid #ffffff' : '2px solid var(--color-surface-elevated, #24292e)',
                boxShadow: isFollowing
                  ? `0 0 0 2px ${color}, 0 2px 6px rgba(0,0,0,0.3)`
                  : '0 1px 3px rgba(0,0,0,0.15)',
                cursor: 'pointer',
                padding: 0,
                outline: 'none',
                userSelect: 'none',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px) scale(1.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0) scale(1)'
              }}
            >
              {initials}
            </button>
            {isFollowing && (
              <span
                style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#10b981',
                  border: '1.5px solid var(--color-surface-elevated, #24292e)'
                }}
                title="Currently Auto-Following"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
