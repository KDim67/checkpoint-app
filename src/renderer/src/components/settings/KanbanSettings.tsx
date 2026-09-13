import { useState, useEffect } from 'react'
import { loadBoardConfig, patchBoardConfig, type ColumnConfig } from '../../lib/boardConfig'

// Kanban per-context column config
export default function KanbanSettings({ activeWorkspace }: { activeWorkspace: string }) {
  const [columns, setColumns] = useState<ColumnConfig[]>([])
  const [loading, setLoading] = useState(true)
  // Track local (not-yet-saved) edits to column names separately
  const [localNames, setLocalNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // Shares the board document with the Kanban view and the AI action
        // blocks. This tab used to keep its own ColumnConfig type and read the
        // raw column key, so it silently dropped colour and colour-mode on
        // every save. Any column styled on the board lost that styling as soon
        // as its WIP limit was edited here.
        const config = await loadBoardConfig(activeWorkspace)
        setColumns(config.columns)
        setLocalNames(Object.fromEntries(config.columns.map(c => [c.id, c.name])))
      } catch (err) { console.error(err) }
      setLoading(false)
    }
    load()
  }, [activeWorkspace])

  const save = async (updated: ColumnConfig[]) => {
    await patchBoardConfig(activeWorkspace, { columns: updated })
    setColumns(updated)
  }

  // Save name only on blur, not on every keystroke
  const handleNameBlur = (id: string) => {
    const newName = localNames[id]?.trim()
    if (!newName) return
    const updated = columns.map(c => c.id === id ? { ...c, name: newName } : c)
    save(updated)
  }

  const updateColWip = (id: string, wipLimit: number | null) =>
    save(columns.map(c => c.id === id ? { ...c, wipLimit } : c))

  if (loading) return <div className="text-sm-faint">Loading…</div>

  return (
    <div className="col-md">
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', margin: 0 }}>
        Set a WIP limit of 0 for unlimited. You can also rename columns by double-clicking their headers on the board itself.
      </p>
      {columns.map(col => (
        <div
          key={col.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-surface-offset)'
          }}
        >
          <input
            value={localNames[col.id] ?? col.name}
            onChange={e => setLocalNames(prev => ({ ...prev, [col.id]: e.target.value }))}
            onBlur={() => handleNameBlur(col.id)}
            style={{
              flex: 1,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: 'var(--text-sm)',
              outline: 'none'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              WIP Limit
            </label>
            <input
              type="number"
              min={0}
              value={col.wipLimit ?? 0}
              onChange={e => {
                const n = parseInt(e.target.value) || 0
                // Track locally but don't save yet
                setColumns(prev => prev.map(c => c.id === col.id ? { ...c, wipLimit: n === 0 ? null : n } : c))
              }}
              onBlur={e => {
                const n = parseInt(e.target.value) || 0
                updateColWip(col.id, n === 0 ? null : n)
              }}
              placeholder="∞"
              style={{
                width: '60px',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                color: 'var(--color-text-base)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                textAlign: 'center'
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
