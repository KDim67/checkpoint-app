import React from 'react'

export interface RemoteCursor {
  peerId: string
  wallId: string
  x: number
  y: number
  name: string
  color: string
  lastSeen: number
}

interface WallRemotePresenceProps {
  cursors: RemoteCursor[]
  zoom: number
}

function WallRemotePresence({ cursors, zoom }: WallRemotePresenceProps) {
  if (cursors.length === 0) return null

  const scale = 1 / Math.max(0.01, zoom)

  return (
    <>
      {cursors.map(cursor => (
        <div
          key={cursor.peerId}
          data-wall-remote-cursor={cursor.peerId}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${cursor.x}px, ${cursor.y}px)`,
            pointerEvents: 'none',
            zIndex: 20,
            transition: 'transform 50ms linear'
          }}
        >
          <div
            data-wall-cursor-scaler
            style={{
              position: 'relative',
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              pointerEvents: 'none'
            }}
          >
            {/* Miro/Figma style cursor arrow */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                display: 'block',
                filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4))'
              }}
            >
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36z"
                fill={cursor.color}
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>

            {/* Peer Name Tag */}
            <div
              data-wall-cursor-tag
              style={{
                position: 'absolute',
                left: '14px',
                top: '16px',
                padding: '2px 7px',
                borderRadius: '4px',
                background: cursor.color,
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 600,
                lineHeight: 1.25,
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
                whiteSpace: 'nowrap',
                userSelect: 'none'
              }}
            >
              {cursor.name}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

export default React.memo(WallRemotePresence)
