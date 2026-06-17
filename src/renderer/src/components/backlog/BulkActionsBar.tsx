import React, { useState } from 'react'
import { X, Trash2, Download, Tag as TagIcon, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import type { Item, Tag as TagType } from '../../../../shared/types'

interface BulkActionsBarProps {
  selectedItems: Item[]
  columns: Array<{ id: string; name: string }>
  allTags: TagType[]
  onClearSelection: () => void
  onBulkUpdateStatus: (status: string) => Promise<void>
  onBulkUpdatePriority: (priority: number) => Promise<void>
  onBulkAddTag: (tagId: string) => Promise<void>
  onBulkDelete: () => Promise<void>
  onExportMarkdown: () => void
}

const PRIORITY_LABELS: Record<number, string> = {
  3: 'High',
  2: 'Medium',
  1: 'Low',
  0: 'None'
}

export default function BulkActionsBar({
  selectedItems,
  columns,
  allTags,
  onClearSelection,
  onBulkUpdateStatus,
  onBulkUpdatePriority,
  onBulkAddTag,
  onBulkDelete,
  onExportMarkdown
}: BulkActionsBarProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showTagMenu, setShowTagMenu] = useState(false)

  if (selectedItems.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        zIndex: 500,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)'
      }}
    >
      {/* Selection count & clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
          {selectedItems.length} selected
        </span>
        <button
          onClick={onClearSelection}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="Clear selection"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ width: '1px', height: '20px', background: 'var(--color-surface-offset)' }} />

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', position: 'relative' }}>
        {/* Bulk Status Update */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu)
              setShowPriorityMenu(false)
              setShowTagMenu(false)
            }}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1.5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          >
            Move Status
          </button>
          
          {showStatusMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: '8px',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                zIndex: 600,
                minWidth: '130px',
                display: 'flex',
                flexDirection: 'column',
                padding: '4px 0',
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)'
              }}
            >
              {columns.map(col => (
                <button
                  key={col.id}
                  onClick={async () => {
                    await onBulkUpdateStatus(col.id)
                    setShowStatusMenu(false)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-base)',
                    padding: 'var(--space-1.5) var(--space-3)',
                    fontSize: '11px',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {col.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bulk Priority Update */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowPriorityMenu(!showPriorityMenu)
              setShowStatusMenu(false)
              setShowTagMenu(false)
            }}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1.5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          >
            Set Priority
          </button>

          {showPriorityMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: '8px',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                zIndex: 600,
                minWidth: '110px',
                display: 'flex',
                flexDirection: 'column',
                padding: '4px 0',
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)'
              }}
            >
              {([3, 2, 1, 0] as const).map(p => (
                <button
                  key={p}
                  onClick={async () => {
                    await onBulkUpdatePriority(p)
                    setShowPriorityMenu(false)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-base)',
                    padding: 'var(--space-1.5) var(--space-3)',
                    fontSize: '11px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ display: 'flex', alignItems: 'center', width: '14px' }}>
                    {p === 3 && <ChevronUp size={12} style={{ color: 'var(--color-priority-high)' }} />}
                    {p === 2 && <ChevronUp size={12} style={{ color: 'var(--color-priority-med)' }} />}
                    {p === 1 && <ChevronDown size={12} style={{ color: 'var(--color-priority-low)' }} />}
                    {p === 0 && <Minus size={12} style={{ color: 'var(--color-text-faint)' }} />}
                  </span>
                  <span>{PRIORITY_LABELS[p]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bulk Add Tag */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setShowTagMenu(!showTagMenu)
              setShowStatusMenu(false)
              setShowPriorityMenu(false)
            }}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-1.5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          >
            <TagIcon size={12} />
            <span>Add Tag</span>
          </button>

          {showTagMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: '8px',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                zIndex: 600,
                minWidth: '150px',
                maxHeight: '180px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                padding: '4px 0',
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)'
              }}
            >
              {allTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={async () => {
                    await onBulkAddTag(tag.id)
                    setShowTagMenu(false)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-base)',
                    padding: 'var(--space-1.5) var(--space-3)',
                    fontSize: '11px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tag.color }} />
                  <span>{tag.name}</span>
                </button>
              ))}
              {allTags.length === 0 && (
                <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', padding: 'var(--space-2) var(--space-3)' }}>
                  No tags created
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ width: '1px', height: '20px', background: 'var(--color-surface-offset)' }} />

      {/* Export & Delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          onClick={onExportMarkdown}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1.5) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          title="Export to Markdown Checklist"
        >
          <Download size={12} />
          <span>Export MD</span>
        </button>

        <button
          onClick={onBulkDelete}
          style={{
            background: 'var(--color-error-muted, rgba(239, 68, 68, 0.15))',
            border: '1px solid var(--color-error, #ef4444)',
            color: 'var(--color-error, #ef4444)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1.5) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
        >
          <Trash2 size={12} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  )
}
