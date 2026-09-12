/**
 * The "create label" half of a tag picker: a name, a colour, and a button.
 *
 * Written out in all three pickers, each reading its input back through
 * `document.getElementById('new-tag-name')`. Three components sharing one DOM
 * id meant that with two pickers mounted, whichever rendered first answered for
 * both. Holding the name in state removes the id and the collision with it.
 */

import React, { useState } from 'react'
import type { Tag } from '../../../../shared/types'
import ColorPicker from './ColorPicker'

/** Enough colours to tell labels apart at a glance, few enough to pick from. */
const SWATCHES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#cdf12b', '#ff45b5']

interface TagCreatorProps {
  /** The new tag, plus the refreshed list. The caller owns both. */
  onCreated: (tag: Tag, tags: Tag[]) => void
}

export default function TagCreator({ onCreated }: TagCreatorProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const created = await window.electronAPI.db.createTag({ name: trimmed, color })
      onCreated(created, await window.electronAPI.db.getTags())
      setName('')
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div style={{
      borderTop: '1px solid var(--color-surface-offset)',
      marginTop: '8px',
      paddingTop: '8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }}>
      <span style={{
        fontSize: '9px',
        fontWeight: 'var(--weight-bold)',
        color: 'var(--color-text-faint)',
        textTransform: 'uppercase'
      }}>
        Create Label
      </span>
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          type="text"
          placeholder="Label name..."
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: '4px',
            color: 'var(--color-text-base)',
            fontSize: '11px',
            padding: '3px 6px',
            outline: 'none',
            minWidth: 0
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            }
          }}
        />
        <button
          onClick={create}
          style={{
            background: 'var(--color-secondary)',
            border: 'none',
            borderRadius: '4px',
            color: 'var(--color-text-inverted)',
            fontWeight: 'var(--weight-bold)',
            fontSize: '10px',
            padding: '3px 8px',
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          Create
        </button>
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {SWATCHES.map(swatch => (
            <button
              key={swatch}
              onClick={() => setColor(swatch)}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: swatch,
                border: color === swatch ? '1px solid var(--color-text-base)' : '1px solid transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          ))}
        </div>
        <ColorPicker
          value={color}
          onCommit={setColor}
          swatchSize={18}
          hexInputWidth={54}
          title="Custom Tag Color"
        />
      </div>
    </div>
  )
}
