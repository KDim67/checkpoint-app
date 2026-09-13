/** name in state; three pickers sharing one DOM id answered for each other */

import React, { useState } from 'react'
import type { Tag } from '../../../../shared/types'
import ColorPicker from './ColorPicker'
import { createTag, listTags } from '../../data/tags'

/** enough to tell apart, few enough to pick from */
const SWATCHES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#cdf12b', '#ff45b5']

interface TagCreatorProps {
  /** the caller owns both */
  onCreated: (tag: Tag, tags: Tag[]) => void
}

export default function TagCreator({ onCreated }: TagCreatorProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const created = await createTag(trimmed, color)
      onCreated(created, await listTags())
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
      <div className="flex-4px">
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
      <div className="row-wrap-6px">
        <div className="row-4px">
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
