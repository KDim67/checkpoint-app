import { useState } from 'react'
import { Tags, X } from 'lucide-react'
import { tagSuggestions } from '../../../../shared/wallTags'

interface Props {
  /** every tag on the picked stickies */
  tags: string[]
  /** the board's own tag names, offered under the field */
  known: string[]
  /** tag colours by lowercased name */
  colors: Map<string, string>
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  onGather: () => void
}

const dot = (colors: Map<string, string>, name: string): string =>
  colors.get(name.toLowerCase()) ?? 'var(--color-text-faint)'

/** the picked stickies' tags to take off, a field that offers the board's own, and gathering by tag */
export default function WallTagEditor({ tags, known, colors, onAdd, onRemove, onGather }: Props) {
  const [draft, setDraft] = useState('')
  const suggestions = tagSuggestions(known, tags, draft)

  const add = (name: string): void => {
    if (!name.trim()) return
    onAdd(name)
    setDraft('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tags.map(tag => (
            <span key={tag} className="wall-tag-pill">
              <span className="wall-tag-dot" style={{ background: dot(colors, tag) }} />
              {tag}
              <button
                type="button"
                className="wall-tag-remove"
                onClick={() => onRemove(tag)}
                title={`Remove ${tag}`}
                aria-label={`Remove the tag ${tag}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>No tags yet.</p>
      )}

      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          // the board's spelling wins, so the same tag doesn't arrive in two cases
          add(known.find(name => name.toLowerCase() === draft.trim().toLowerCase()) ?? draft)
        }}
        placeholder="Add a tag"
        aria-label="Add a tag"
        className="input-fill"
        style={{ fontSize: 'var(--text-xs)' }}
      />

      {suggestions.length > 0 && (
        <div role="group" aria-label="Tags on the board" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {suggestions.map(name => (
            <button key={name} type="button" className="wall-tag-suggestion" onClick={() => add(name)}>
              <span className="wall-tag-dot" style={{ background: dot(colors, name) }} />
              {name}
            </button>
          ))}
        </div>
      )}

      <button type="button" className="wall-link-action" onClick={onGather}>
        <Tags size={12} />
        Gather by tag
      </button>
    </div>
  )
}
