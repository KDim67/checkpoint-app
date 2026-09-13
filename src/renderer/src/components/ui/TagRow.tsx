/**
 * One label in a tag picker: press it to attach or detach, recolour it, or
 * delete it everywhere.
 *
 * Three screens carry the same picker, and the row was written out three times.
 * Adding the delete button meant making the identical edit in each of them,
 * which is the argument for this file.
 *
 * The data calls live here rather than in the callers, so a screen that shows
 * tags does not also have to know how tags are stored. What it does have to
 * supply is what happens after: the list it renders and the selection it holds
 * are its own state, so it is told to refresh them.
 */

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
  /** The tag list changed. Hand back the new one. */
  onTagsChanged: (tags: Tag[]) => void
  /** A tag was deleted, so it cannot still be selected. */
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
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
        gap: '6px'
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
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
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-faint)',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-faint)')}
        >
          <Trash2 size={12} />
        </button>
        {isSelected && <Check size={12} className="text-accent" />}
      </div>
    </div>
  )
}
