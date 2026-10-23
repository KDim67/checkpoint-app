import { useState, useEffect } from 'react'
import { loadBoardConfig, patchBoardConfig, type ColumnConfig } from '../../lib/boardConfig'
import { useFailureReport } from '../ui/Toast'
import { SkeletonBlocks } from '../ui/Skeleton'

// per-context column config
export default function KanbanSettings({ activeWorkspace }: { activeWorkspace: string }) {
  const report = useFailureReport()
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [loading, setLoading] = useState(true)
  // unsaved name edits kept apart
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // shares the board doc; its own type dropped colour and colour-mode on every WIP save
        const config = await loadBoardConfig(activeWorkspace)
        setColumns(config.columns)
        setLocalNames(Object.fromEntries(config.columns.map(c => [c.id, c.name])))
      } catch (err) { report('load the board columns', err) }
      setLoading(false)
    }
    load()
  }, [activeWorkspace, report])

  const save = async (updated: ColumnConfig[]) => {
    await patchBoardConfig(activeWorkspace, { columns: updated })
    setColumns(updated)
  }

  // save names on blur, not per keystroke
  const handleNameBlur = (id: string) => {
    const newName = localNames[id]?.trim()
    if (!newName) return
    const updated = columns.map(c => c.id === id ? { ...c, name: newName } : c)
    save(updated)
  }

  const updateColWip = (id: string, wipLimit: number | null) =>
    save(columns.map(c => c.id === id ? { ...c, wipLimit } : c))

  if (loading) return <SkeletonBlocks label="Loading the columns" count={4} height="3.25rem" gap="var(--space-2)" />

  return (
    <div className="col-md">
      <p className="text-sub" style={{ margin: 0 }}>
        A limit of 0 lets a column hold any number of cards. Double-clicking a column's name on the board renames it too.
      </p>
      <ul className="settings-list" aria-label="Columns">
        {columns.map((col, index) => (
          <li key={col.id} className="settings-list-row">
            <input
              value={localNames[col.id] ?? col.name}
              onChange={e => setLocalNames(prev => ({ ...prev, [col.id]: e.target.value }))}
              onBlur={() => handleNameBlur(col.id)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              aria-label={`Name of column ${index + 1}`}
              className="input-md"
              style={{ flex: '1 1 12rem', minWidth: 0, background: 'var(--color-surface-2)' }}
            />
            <div className="row">
              <label htmlFor={`wip-${col.id}`} className="text-hint" style={{ whiteSpace: 'nowrap' }}>
                WIP limit
              </label>
              <input
                id={`wip-${col.id}`}
                type="number"
                min={0}
                inputMode="numeric"
                value={col.wipLimit ?? 0}
                onChange={e => {
                  const n = parseInt(e.target.value) || 0
                  // tracked locally, not saved yet
                  setColumns(prev => prev.map(c => c.id === col.id ? { ...c, wipLimit: n === 0 ? null : n } : c))
                }}
                onBlur={e => {
                  const n = parseInt(e.target.value) || 0
                  updateColWip(col.id, n === 0 ? null : n)
                }}
                className="input-md"
                style={{ width: '5rem', textAlign: 'center', background: 'var(--color-surface-2)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
