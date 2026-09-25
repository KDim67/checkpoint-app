import React from 'react'
import type { PeerPresenceState } from '../../lib/useCollabFollow'

interface CollabFollowBannerProps {
  followingPeer: PeerPresenceState | null
  onStop: () => void
}

function formatViewName(view?: string): string {
  if (!view) return 'Wall'
  switch (view) {
    case 'wall': return 'Wall'
    case 'kanban': return 'Kanban'
    case 'backlog': return 'Backlog'
    case 'notes': return 'Notes'
    case 'focus': return 'Focus'
    default: return view.charAt(0).toUpperCase() + view.slice(1)
  }
}

export default function CollabFollowBanner({ followingPeer, onStop }: CollabFollowBannerProps) {
  if (!followingPeer) return null

  return (
    <div
      data-testid="collab-follow-banner"
      style={{
        position: 'fixed',
        top: '36px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 14px',
        background: 'var(--color-surface-elevated, #24292e)',
        border: `1.5px solid ${followingPeer.color}`,
        borderRadius: 'var(--radius-full, 9999px)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        color: 'var(--color-text-base, #ffffff)',
        fontSize: '12px',
        fontWeight: 600,
        pointerEvents: 'auto',
        animation: 'dropdown-in 150ms var(--ease-enter)'
      }}
      role="status"
      aria-live="polite"
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: followingPeer.color,
          flexShrink: 0,
          boxShadow: `0 0 6px ${followingPeer.color}`
        }}
      />
      <span>
        Following <strong>{followingPeer.name}</strong> ({formatViewName(followingPeer.view)})
      </span>
      <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #8b949e)', fontWeight: 400 }}>
        · Esc to stop
      </span>
      <button
        type="button"
        onClick={onStop}
        style={{
          background: 'var(--color-surface-offset, rgba(255, 255, 255, 0.12))',
          border: '1px solid var(--color-surface-offset, rgba(255, 255, 255, 0.15))',
          borderRadius: 'var(--radius-sm, 4px)',
          padding: '2px 8px',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--color-text-base, #ffffff)',
          cursor: 'pointer',
          marginLeft: '4px',
          transition: 'background 150ms ease'
        }}
        title="Stop following (Escape)"
      >
        Stop
      </button>
    </div>
  )
}
