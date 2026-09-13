import React, { useState } from 'react'
import { X, Trash2, Download, Tag as TagIcon, ChevronUp, ChevronDown, Minus } from 'lucide-react'
import type { Item, Tag as TagType } from '../../../../shared/types'
import { PRIORITY_LABELS, PRIORITY_LEVELS } from '../../lib/priority'

interface BulkActionsBarProps {
  selectedItems: Item[]
  columns: Array<{ id: string; name: string }>
  allTags: TagType[]
  onClearSelection: () => void
  onBulkUpdateStatus: (status: string) => Promise<void>
  onBulkUpdatePriority: (priority: number) => Promise<void>
  onBulkAddTag: (tagId: string) => Promise<void>
  onBulkDelete: () => void
  onExportMarkdown: () => void
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
      <div className="row">
        <span className="text-label-xs">
          {selectedItems.length} selected
        </span>
        <button
          onClick={onClearSelection}
          className="text-muted hover-text-base"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center'
          }}
          title="Clear selection"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ width: '1px', height: '20px', background: 'var(--color-surface-offset)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', position: 'relative' }}>
        <div className="relative">
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu)
              setShowPriorityMenu(false)
              setShowTagMenu(false)
            }}
            className="bg-surface-2 hover-bg-offset"
            style={{
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
                  className="bg-clear hover-bg-offset"
                  style={{
                    border: 'none',
                    color: 'var(--color-text-base)',
                    padding: 'var(--space-1.5) var(--space-3)',
                    fontSize: '11px',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                >
                  {col.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setShowPriorityMenu(!showPriorityMenu)
              setShowStatusMenu(false)
              setShowTagMenu(false)
            }}
            className="bg-surface-2 hover-bg-offset"
            style={{
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
              {PRIORITY_LEVELS.map(p => (
                <button
                  key={p}
                  onClick={async () => {
                    await onBulkUpdatePriority(p)
                    setShowPriorityMenu(false)
                  }}
                  className="bg-clear hover-bg-offset"
                  style={{
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
                >
                  <span style={{ display: 'flex', alignItems: 'center', width: '14px' }}>
                    {p === 3 && <ChevronUp size={12} style={{ color: 'var(--color-priority-high)' }} />}
                    {p === 2 && <ChevronUp size={12} style={{ color: 'var(--color-priority-med)' }} />}
                    {p === 1 && <ChevronDown size={12} style={{ color: 'var(--color-priority-low)' }} />}
                    {p === 0 && <Minus size={12} className="text-faint" />}
                  </span>
                  <span>{PRIORITY_LABELS[p]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setShowTagMenu(!showTagMenu)
              setShowStatusMenu(false)
              setShowPriorityMenu(false)
            }}
            className="bg-surface-2 hover-bg-offset"
            style={{
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
                  className="bg-clear hover-bg-offset"
                  style={{
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

      <div className="row">
        <button
          onClick={onExportMarkdown}
          className="bg-surface-2 hover-bg-offset"
          style={{
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
          title="Export to Markdown Checklist"
        >
          <Download size={12} />
          <span>Export MD</span>
        </button>

        <button
          onClick={onBulkDelete}
          className="hover-brighten"
          style={{
            background: 'var(--color-error-muted)',
            border: '1px solid var(--color-error)',
            color: 'var(--color-error)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1.5) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <Trash2 size={12} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  )
}
