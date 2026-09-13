import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { authorLabel, DISPLAY_NAME_MAX } from '@shared/identity'
import HeaderBtn from './HeaderBtn'
import type { CollabSession } from './useCollabSession'

export default function CollabPanel({ session }: { session: CollabSession }) {
  const setWorkspace = useAppStore(s => s.setWorkspace)
  const setView = useAppStore(s => s.setView)
  const setSettingsTab = useAppStore(s => s.setSettingsTab)
  const { toast } = useToast()

  const collabPopoverRef = useRef<HTMLDivElement>(null)
  const { setPopoverOpen } = session

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (collabPopoverRef.current && !collabPopoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setPopoverOpen])

  return (
    <div className="relative" ref={collabPopoverRef}>
      <HeaderBtn
        onClick={() => session.setPopoverOpen(v => !v)}
        title="Share this board with someone else"
        icon={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: session.active ? 'var(--color-secondary)' : 'inherit' }}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        }
        active={session.popoverOpen}
      >
        {session.active ? (session.isHost ? 'Hosting Live' : 'Joined Live') : 'Share'}
        {session.active && (
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--color-secondary)',
            marginLeft: '4px'
          }} />
        )}
      </HeaderBtn>

      {session.popoverOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 100,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-xl)',
            width: '280px',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            animation: 'dropdown-in 150ms var(--ease-enter)'
          }}
        >
          <div className="section-head-between">
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Share This Board
            </span>
            {session.active && (
              <span style={{
                fontSize: '10px',
                background: session.elsewhere ? 'var(--color-warning-muted)' : 'var(--color-secondary-muted)',
                color: session.elsewhere ? 'var(--color-warning)' : 'var(--color-secondary)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-full)',
                fontWeight: 'var(--weight-semibold)'
              }}>
                {session.elsewhere ? 'Elsewhere' : 'Active'}
              </span>
            )}
          </div>

          {/* The session belongs to the workspace it was started in and
              stays there when you move, so nothing you do here is shared
              and nothing they do shows up. It said Active throughout,
              which read exactly like a dead connection. */}
          {session.elsewhere && (
            <div style={{
              fontSize: '11px',
              color: 'var(--color-warning)',
              background: 'var(--color-warning-muted)',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              lineHeight: 1.4
            }}>
              You are sharing <strong>#{session.workspace}</strong>, not the board you are looking
              at. Nothing here is being shared.
              <button
                onClick={() => {
                  setWorkspace(session.workspace)
                  session.setPopoverOpen(false)
                }}
                style={{
                  display: 'block',
                  marginTop: '6px',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: 'var(--color-warning)',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                Go back to #{session.workspace}
              </button>
            </div>
          )}

          {!session.active ? (
            <div className="col-md">
              {/* Who you are, once, for both hosting and joining. Card
                  history credits this name, so it is worth setting before
                  a board is shared rather than after. */}
              <div className="col">
                <span className="text-label-xs-medium">Your Name</span>
                <p className="text-caption-flush">
                  Shown against your changes on a shared board.
                  {session.osUserName && ` Left empty, changes are credited to ${session.osUserName}.`}
                </p>
                <input
                  value={session.displayName}
                  maxLength={DISPLAY_NAME_MAX}
                  onChange={e => session.setDisplayName(e.target.value)}
                  onBlur={session.saveDisplayName}
                  // The fallback rather than an invented example, so the
                  // empty field shows what it will actually do.
                  placeholder={session.osUserName || 'e.g. Dimitris'}
                  style={{
                    marginTop: '2px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-base)',
                    fontSize: 'var(--text-xs)',
                    padding: '6px var(--space-2)',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Host section */}
              <div className="col">
                <span className="text-label-xs-medium">Invite Someone</span>
                <p className="text-caption-flush">Give another person this board to read or edit, live, while you both have it open.</p>
                
                <div className="flex-gap-mt2">
                  <button
                    onClick={() => {
                      session.host('collaborative')
                    }}
                    style={{
                      flex: 1,
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      background: 'var(--color-secondary-muted)',
                      color: 'var(--color-secondary)',
                      border: '1px solid var(--color-secondary)',
                      padding: '6px 0',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-secondary)'
                      e.currentTarget.style.color = '#fff'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--color-secondary-muted)'
                      e.currentTarget.style.color = 'var(--color-secondary)'
                    }}
                  >
                    Collaborative
                  </button>
                  <button
                    onClick={() => {
                      session.host('readonly')
                    }}
                    style={{
                      flex: 1,
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      background: 'var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      border: '1px solid var(--color-surface-offset)',
                      padding: '6px 0',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-surface-offset)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    Read-Only
                  </button>
                </div>
              </div>

              <div style={{ height: '1px', background: 'var(--color-surface-offset)' }} />

              {/* Join section */}
              <div className="col">
                <span className="text-label-xs-medium">Join Someone's Board</span>
                <div className="flex-4px">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Passcode (e.g. 123456)"
                    value={session.joinCode}
                    onChange={e => session.setJoinCode(e.target.value.replace(/\D/g, ''))}
                    style={{
                      flex: 1,
                      background: 'var(--color-surface-offset)',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-md)',
                      padding: '4px 8px',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-base)',
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => {
                      session.join(session.joinCode)
                    }}
                    disabled={session.joinCode.length < 5}
                    style={{
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      background: session.joinCode.length < 5 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
                      color: session.joinCode.length < 5 ? 'var(--color-text-muted)' : '#fff',
                      border: 'none',
                      padding: '0 var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      cursor: session.joinCode.length < 5 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Join
                  </button>
                </div>
              </div>

              {/* The two features are one word apart and were being
                  mistaken for each other. Each now says what it is not
                  and where the other one lives. */}
              <p style={{
                fontSize: '11px',
                color: 'var(--color-text-faint)',
                margin: 0,
                paddingTop: 'var(--space-2)',
                borderTop: '1px solid var(--color-surface-offset)',
                lineHeight: 1.4
              }}>
                This is for another person, and covers this board only. To keep your own
                machines in step, use{' '}
                <button
                  onClick={() => {
                    session.setPopoverOpen(false)
                    setView('settings')
                    setSettingsTab('sync')
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: 'var(--color-secondary)',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Device Sync
                </button>.
              </p>
            </div>
          ) : (
            <div className="col-md">
              {/* Active session state */}
              <div style={{ background: 'var(--color-surface-offset)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div className="row-between">
                  <span className="text-caption">Role:</span>
                  <span style={{ fontSize: '11px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
                    {session.isHost ? `Host (${session.mode === 'readonly' ? 'Read-Only' : 'Collaborative'})` : 'Client'}
                  </span>
                </div>
                
                {session.code && (
                  <div className="row-between">
                    <span className="text-caption">Passcode:</span>
                    <span
                      onClick={() => {
                        navigator.clipboard.writeText(session.code)
                        toast('Passcode copied to clipboard')
                      }}
                      style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 'var(--weight-bold)', color: 'var(--color-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Click to copy passcode"
                    >
                      {session.code}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    </span>
                  </div>
                )}

                {/* Who is in the room. The session used to report only
                    that somebody was, which is no basis for deciding
                    whether they should stay. */}
                <div className="col-4px">
                  <span className="text-caption">
                    {session.isHost
                      ? `In this board (${session.roster.length})`
                      : `Also here (${session.roster.length})`}
                  </span>
                  {session.roster.length === 0 ? (
                    <span className="text-caption-faint">
                      Nobody yet
                    </span>
                  ) : (
                    session.roster.map(member => (
                      <div key={member.id} className="row-between" style={{ gap: 'var(--space-2)' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 'var(--weight-semibold)',
                          color: 'var(--color-text-base)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {authorLabel(member.name)}
                        </span>
                        {/* Removing is the host's, and not from a board
                            it is not looking at. */}
                        {session.isHost && !session.elsewhere && (
                          <button
                            onClick={() => session.removeGuest(member)}
                            title={`Remove ${authorLabel(member.name)}`}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: '0 2px',
                              fontSize: '10px',
                              fontWeight: 'var(--weight-semibold)',
                              color: 'var(--color-text-faint)',
                              cursor: 'pointer',
                              flexShrink: 0
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-warning)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-faint)')}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div style={{ height: '1px', background: 'var(--color-surface-1)', margin: '4px 0' }} />

                <div className="col-2px">
                  <span className="text-micro-faint">Status Logs:</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.progress}
                  </span>
                </div>
              </div>

              {/* What the host can do about the person in the room. Only
                  the host, and only while someone is in it. */}
              {session.isHost && (
                <div className="col">
                  <button
                    onClick={() => session.setGuestMode(session.mode === 'readonly' ? 'collaborative' : 'readonly')}
                    title={session.mode === 'readonly'
                      ? 'Let them make changes to the board'
                      : 'Let them look, but not change anything'}
                    style={{
                      width: '100%',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      background: 'transparent',
                      color: 'var(--color-text-base)',
                      border: '1px solid var(--color-surface-offset)',
                      padding: '6px 0',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'border-color var(--duration-fast) var(--ease-default)'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
                  >
                    {session.mode === 'readonly' ? 'Let them edit' : 'Make it read-only'}
                  </button>

                  {!session.elsewhere && (
                    <button
                      onClick={session.rotateCode}
                      title="Disconnect everyone and issue a new passcode"
                      style={{
                        width: '100%',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        background: 'transparent',
                        color: 'var(--color-warning)',
                        border: '1px solid var(--color-warning)',
                        padding: '6px 0',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'background var(--duration-fast) var(--ease-default)'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-warning-muted)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      Change passcode
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={session.disconnect}
                style={{
                  width: '100%',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  background: 'var(--color-destructive-muted)',
                  color: 'var(--color-destructive)',
                  border: '1px solid var(--color-destructive)',
                  padding: '6px 0',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-destructive)'
                  e.currentTarget.style.color = '#fff'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--color-destructive-muted)'
                  e.currentTarget.style.color = 'var(--color-destructive)'
                }}
              >
                Disconnect Share
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
