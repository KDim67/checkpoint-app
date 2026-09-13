/** one row for the three pickers; data calls here, callers refresh their own list and selection */

import React from 'react'
import { Check, Trash2 } from 'lucide-react'
import type { Tag } from '../../../../shared/types'
import ColorPicker from './ColorPicker'
import { useConfirm } from './ConfirmDialog'
import { deleteTag, recolourTag } from '../../data/tags'

interface TagRowProps {
  tag: Tag
  isSelected: boolean
  onToggle: (tagId: string) => void
  /** hands back the new list */
  onTagsChanged: (tags: Tag[]) => void
  /** so it can't stay selected */
  onDeleted: (tagId: string) => void
}

export default function TagRow({ tag, isSelected, onToggle, onTagsChanged, onDeleted }: TagRowProps) {
  const confirm = useConfirm()

  const recolour = async (color: string): Promise<void> => {
    try {
      onTagsChanged(await recolourTag(tag.id, color))
    } catch (err) {
      console.error(err)
    }
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${tag.name}"?`,
      message: 'The label goes with it, off every card and task that carries it.',
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!ok) return
    try {
      onDeleted(tag.id)
      onTagsChanged(await deleteTag(tag.id))
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div
      className="hover-bg-offset"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
        gap: '6px'
      }}
    >
      <button
        onClick={() => onToggle(tag.id)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-base)',
          padding: 0,
          fontSize: 'var(--text-xs)',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flex: 1
        }}
      >
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
        <span className="truncate">{tag.name}</span>
      </button>
      <div className="row-6px-fixed">
        <ColorPicker
          value={tag.color}
          showHexInput={false}
          swatchSize={14}
          title="Edit Tag Color"
          onCommit={recolour}
        />
        <button
          onClick={remove}
          title="Delete label"
          className="text-faint hover-text-error"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Trash2 size={12} />
        </button>
        {isSelected && <Check size={12} className="text-accent" />}
      </div>
    </div>
  )
}
