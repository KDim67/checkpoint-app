import type { Dispatch, SetStateAction } from 'react'
import { ChevronDown, ChevronUp, Copy, Layers2, Pencil, Plus, Trash2 } from 'lucide-react'
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
  duplicateWall?: (wall: WallRef) => void
  moveWall?: (id: string, direction: -1 | 1) => void
  setPendingDelete: Dispatch<SetStateAction<WallRef | null>>
}

export default function WallSwitcher({
  wallIndex, activeWall, wallMenuOpen, setWallMenuOpen, renaming, setRenaming, commitIndex, addWall, duplicateWall, moveWall, setPendingDelete
}: WallSwitcherProps) {
  return (
    <div data-wall-popover="wall" className="relative">
      <button
        onClick={() => { setWallMenuOpen(v => !v); setRenaming(null) }}
        title="Walls: switch between them (PageUp / PageDown, mouse buttons 4 & 5), rename one, or start another"
        aria-label={`Wall: ${activeWall?.name ?? 'loading'}. Switch, rename or add a wall`}
        aria-haspopup="menu"
        aria-expanded={wallMenuOpen}
        disabled={!wallIndex}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
          maxWidth: '190px', height: '30px', padding: '0 var(--space-2)',
          background: wallMenuOpen ? 'var(--color-surface-offset)' : 'transparent',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-base)', fontSize: 'var(--text-xs)',
          fontWeight: 500, cursor: wallIndex ? 'pointer' : 'default'
        }}
      >
        {/* the icon says these are walls, the name alone read as a label */}
        <Layers2 size={13} className="icon-faint" style={{ flexShrink: 0 }} />
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
              width: '270px', padding: '4px',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            {wallIndex.walls.map((w, i) => {
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
                      color: 'var(--color-text-base)', fontSize: 'var(--text-xs)'
                    }}
                  />
                )
              }

              return (
                <div
                  key={w.id}
                  className="wall-switcher-row"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '2px',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-surface-offset)' : 'transparent'
                  }}
                >
                  <button
                    onClick={() => { commitIndex(setActiveWall(wallIndex, w.id)); setWallMenuOpen(false) }}
                    onKeyDown={e => {
                      if (e.altKey && e.key === 'ArrowUp') {
                        e.preventDefault()
                        moveWall?.(w.id, -1)
                      } else if (e.altKey && e.key === 'ArrowDown') {
                        e.preventDefault()
                        moveWall?.(w.id, 1)
                      }
                    }}
                    title={`${w.name}${wallIndex.walls.length > 1 ? ' · Alt+Up/Down to reorder' : ''}`}
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

                  {wallIndex.walls.length > 1 && (
                    <>
                      <button
                        onClick={() => moveWall?.(w.id, -1)}
                        disabled={i === 0}
                        title="Move up (Alt+Up)"
                        aria-label={`Move ${w.name} up`}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', flexShrink: 0, opacity: i === 0 ? 0.3 : 1 }}
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveWall?.(w.id, 1)}
                        disabled={i === wallIndex.walls.length - 1}
                        title="Move down (Alt+Down)"
                        aria-label={`Move ${w.name} down`}
                        className="btn-icon"
                        style={{ width: '22px', height: '22px', flexShrink: 0, opacity: i === wallIndex.walls.length - 1 ? 0.3 : 1 }}
                      >
                        <ChevronDown size={12} />
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => duplicateWall?.(w)}
                    title="Duplicate wall"
                    aria-label={`Duplicate ${w.name}`}
                    className="btn-icon"
                    style={{ width: '22px', height: '22px', flexShrink: 0 }}
                  >
                    <Copy size={12} />
                  </button>

                  <button
                    onClick={() => setRenaming({ id: w.id, draft: w.name })}
                    title="Rename"
                    aria-label={`Rename ${w.name}`}
                    className="btn-icon"
                    style={{ width: '22px', height: '22px', flexShrink: 0 }}
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
                      style={{ width: '22px', height: '22px', flexShrink: 0, marginRight: '2px' }}
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
