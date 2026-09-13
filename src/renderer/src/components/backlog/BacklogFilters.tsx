import { Filter, RefreshCw } from 'lucide-react'
import type { Tag as TagType } from '../../../../shared/types'

interface BacklogFiltersProps {
  columns: Array<{ id: string; name: string }>
  allTags: TagType[]
  selectedStatuses: string[]
  setSelectedStatuses: (status: string[]) => void
  selectedPriorities: number[]
  setSelectedPriorities: (priorities: number[]) => void
  selectedTagIds: string[]
  setSelectedTagIds: (tagIds: string[]) => void
  dueStart: string
  setDueStart: (dateStr: string) => void
  dueEnd: string
  setDueEnd: (dateStr: string) => void
  hasRelations: string // 'all' | 'yes' | 'no'
  setHasRelations: (val: string) => void
  onReset: () => void
}

export default function BacklogFilters({
  columns,
  allTags,
  selectedStatuses,
  setSelectedStatuses,
  selectedPriorities,
  setSelectedPriorities,
  selectedTagIds,
  setSelectedTagIds,
  dueStart,
  setDueStart,
  dueEnd,
  setDueEnd,
  hasRelations,
  setHasRelations,
  onReset
}: BacklogFiltersProps) {
  const isDateRangeInvalid = dueStart && dueEnd && dueStart > dueEnd

  const handleStatusToggle = (statusId: string) => {
    if (selectedStatuses.includes(statusId)) {
      setSelectedStatuses(selectedStatuses.filter(s => s !== statusId))
    } else {
      setSelectedStatuses([...selectedStatuses, statusId])
    }
  }

  const handlePriorityToggle = (priorityNum: number) => {
    if (selectedPriorities.includes(priorityNum)) {
      setSelectedPriorities(selectedPriorities.filter(p => p !== priorityNum))
    } else {
      setSelectedPriorities([...selectedPriorities, priorityNum])
    }
  }

  const handleTagToggle = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      setSelectedTagIds(selectedTagIds.filter(id => id !== tagId))
    } else {
      setSelectedTagIds([...selectedTagIds, tagId])
    }
  }

  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4) var(--space-6)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-4)'
    }}>
      <div className="row-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-base)' }}>
          <Filter size={14} />
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Filter Registry
          </span>
        </div>
        
        <button
          onClick={onReset}
          className="text-muted hover-text-base"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--text-2xs)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: 0
          }}
        >
          <RefreshCw size={10} /> Reset Filters
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
        gap: 'var(--space-4)'
      }}>
        <div className="col">
          <span className="label-caps-sm">
            Workflow Stages
          </span>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '100px',
            overflowY: 'auto',
            padding: '2px 0'
          }}>
            {columns.map(col => (
              <label
                key={col.id}
                className="check-row"
              >
                <input
                  type="checkbox"
                  checked={selectedStatuses.includes(col.id)}
                  onChange={() => handleStatusToggle(col.id)}
                  className="clickable"
                />
                <span>{col.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="col">
          <span className="label-caps-sm">
            Priority
          </span>
          <div className="col-4px">
            {[
              { num: 3, label: 'High' },
              { num: 2, label: 'Medium' },
              { num: 1, label: 'Low' },
              { num: 0, label: 'None' }
            ].map(p => (
              <label
                key={p.num}
                className="check-row"
              >
                <input
                  type="checkbox"
                  checked={selectedPriorities.includes(p.num)}
                  onChange={() => handlePriorityToggle(p.num)}
                  className="clickable"
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="col">
          <span className="label-caps-sm">
            Tags
          </span>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '100px',
            overflowY: 'auto',
            padding: '2px 0'
          }}>
            {allTags.map(tag => (
              <label
                key={tag.id}
                className="check-row"
              >
                <input
                  type="checkbox"
                  checked={selectedTagIds.includes(tag.id)}
                  onChange={() => handleTagToggle(tag.id)}
                  className="clickable"
                />
                <span className="row-4px">
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tag.color }} />
                  {tag.name}
                </span>
              </label>
            ))}
            {allTags.length === 0 && (
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)' }}>
                No tags created
              </span>
            )}
          </div>
        </div>

        <div className="col">
          <span className="label-caps-sm">
            Due Date Range
          </span>
          <div className="col-6px">
            <div className="row-4px">
              <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', width: '30px' }}>From</span>
              <input
                type="date"
                value={dueStart}
                onChange={e => setDueStart(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: isDateRangeInvalid ? '1px solid var(--color-warning)' : '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: 'var(--text-2xs)',
                  outline: 'none',
                  flex: 1
                }}
              />
            </div>
            <div className="row-4px">
              <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', width: '30px' }}>To</span>
              <input
                type="date"
                value={dueEnd}
                onChange={e => setDueEnd(e.target.value)}
                style={{
                  background: 'var(--color-surface-1)',
                  border: isDateRangeInvalid ? '1px solid var(--color-warning)' : '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: '4px',
                  padding: '2px 4px',
                  fontSize: 'var(--text-2xs)',
                  outline: 'none',
                  flex: 1
                }}
              />
            </div>
            {isDateRangeInvalid && (
              <span style={{ fontSize: '9px', color: 'var(--color-warning)', marginTop: '2px' }}>
                ⚠️ Start date is after end date
              </span>
            )}
          </div>
        </div>

        <div className="col">
          <span className="label-caps-sm">
            Link Relations
          </span>
          <select
            value={hasRelations}
            onChange={e => setHasRelations(e.target.value)}
            style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              outline: 'none'
            }}
          >
            <option value="all">Show All</option>
            <option value="yes">Has Links</option>
            <option value="no">Has No Links</option>
          </select>
        </div>
      </div>
    </div>
  )
}
