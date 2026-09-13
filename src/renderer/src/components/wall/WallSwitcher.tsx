import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { renameWall, setActiveWall, type WallIndex, type WallRef } from '../../../../shared/wallModel'

type Renaming = { id: string; draft: string } | null

interface WallSwitcherProps {
  wallIndex: WallIndex | null
  activeWall: WallRef | null
  wallMenuOpen: boolean
  setWallMenuOpen: Dispatch<SetStateAction<boolean>>
  renaming: Renaming
  setRenaming: Dispatch<SetStateAction<Renaming>>
  commitIndex: (next: WallIndex) => void
  addWall: () => void
  setPendingDelete: Dispatch<SetStateAction<WallRef | null>>
}

export default function WallSwitcher({
  wallIndex, activeWall, wallMenuOpen, setWallMenuOpen, renaming, setRenaming, commitIndex, addWall, setPendingDelete
}: WallSwitcherProps) {
  return (
    <div data-wall-popover="wall" className="relative">
      <button
        onClick={() => { setWallMenuOpen(v => !v); setRenaming(null) }}
        title="Switch wall"
        aria-haspopup="menu"
        aria-expanded={wallMenuOpen}
        disabled={!wallIndex}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
          maxWidth: '170px', height: '30px', padding: '0 var(--space-2)',
          background: wallMenuOpen ? 'var(--color-surface-offset)' : 'transparent',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-base)', fontSize: 'var(--text-xs)',
          fontWeight: 500, cursor: wallIndex ? 'pointer' : 'default'
        }}
      >
        <span className="truncate">
          {activeWall?.name ?? '…'}
        </span>
        {/* hint that there's a choice */}
        <ChevronDown size={12} className="icon-faint" />
      </button>

      {wallMenuOpen && wallIndex && (
        <>
          <div
            role="menu"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
              width: '240px', padding: '4px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            {wallIndex.walls.map(w => {
              const isActive = w.id === wallIndex.activeId
              const isRenaming = renaming?.id === w.id

              if (isRenaming) {
                return (
                  <input
                    key={w.id}
                    autoFocus
                    value={renaming.draft}
                    onChange={e => setRenaming({ id: w.id, draft: e.target.value })}
                    // commit on blur, clicking away isn't discarding
                    onBlur={() => {
                      commitIndex(renameWall(wallIndex, w.id, renaming.draft))
                      setRenaming(null)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        commitIndex(renameWall(wallIndex, w.id, renaming.draft))
                        setRenaming(null)
                      }
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    aria-label="Wall name"
                    style={{
                      display: 'block', width: '100%', boxSizing: 'border-box',
                      padding: 'var(--space-2)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-secondary)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-base)', fontSize: 'var(--text-xs)',
                      outline: 'none'
                    }}
                  />
                )
              }

              return (
                <div
                  key={w.id}
                  className="wall-switcher-row"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-surface-offset)' : 'transparent'
                  }}
                >
                  <button
                    onClick={() => { commitIndex(setActiveWall(wallIndex, w.id)); setWallMenuOpen(false) }}
                    style={{
                      flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 'var(--space-2)',
                      color: isActive ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      fontSize: 'var(--text-xs)', fontWeight: isActive ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}
                  >
                    {w.name}
                  </button>

                  <button
                    onClick={() => setRenaming({ id: w.id, draft: w.name })}
                    title="Rename"
                    aria-label={`Rename ${w.name}`}
                    className="btn-icon"
                    style={{ width: '24px', height: '24px', flexShrink: 0 }}
                  >
                    <Pencil size={12} />
                  </button>

                  {/* hidden, not disabled: always grey reads broken */}
                  {wallIndex.walls.length > 1 && (
                    <button
                      onClick={() => { setPendingDelete(w); setWallMenuOpen(false) }}
                      title="Delete wall"
                      aria-label={`Delete ${w.name}`}
                      className="btn-icon"
                      style={{ width: '24px', height: '24px', flexShrink: 0, marginRight: '2px' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}

            <div className="rule" />

            <button
              onClick={addWall}
              className="bg-clear hover-bg-offset"
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
                border: 'none', cursor: 'pointer',
                padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)'
              }}
            >
              <Plus size={12} /> New wall
            </button>
          </div>
        </>
      )}
    </div>
  )
}
