import { useState } from 'react'
import { ExternalLink, MousePointerClick, Unlink } from 'lucide-react'
import { normalizeLinkInput } from '../../../../shared/wallLink'

interface Props {
  /** the stored link, if there is one */
  link?: string
  /** the chip's words for it */
  label?: string
  onSave: (link: string) => void
  onRemove: () => void
  onPick: () => void
  onOpen: (link: string) => void
  onClose: () => void
}

/** one field for both kinds: a web address, or an item link copied from any wall */
export default function WallLinkEditor({ link, label, onSave, onRemove, onPick, onOpen, onClose }: Props) {
  const [draft, setDraft] = useState(link ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = (): void => {
    const next = normalizeLinkInput(draft)
    if (!next) {
      setError('Enter a web address like github.com, or paste a link from Copy link to this item.')
      return
    }
    onSave(next)
    onClose()
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); save() }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      {label && (
        <span className="truncate" style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
          Links to {label}
        </span>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <input
          autoFocus
          aria-label="Link address"
          aria-invalid={error ? true : undefined}
          value={draft}
          placeholder="github.com or a copied item link"
          onChange={e => { setDraft(e.target.value); setError(null) }}
          // the Wall's Escape clears the selection, this one only closes the field
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
          className="focus-border-accent"
          style={{
            flex: 1, minWidth: 0, height: '28px', padding: '0 var(--space-2)',
            fontSize: 'var(--text-xs)', color: 'var(--color-text-base)',
            background: 'var(--color-surface-2)',
            border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-surface-offset)'}`,
            borderRadius: 'var(--radius-sm)', outline: 'none'
          }}
        />
        <button type="submit" className="wall-link-save">Save</button>
      </div>

      {error && (
        <span role="alert" style={{ fontSize: '11px', lineHeight: 1.4, color: 'var(--color-error)' }}>
          {error}
        </span>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
        <button type="button" className="wall-link-action" onClick={() => { onPick(); onClose() }}>
          <MousePointerClick size={12} />
          Pick an item on this wall
        </button>
        {link && (
          <>
            <button type="button" className="wall-link-action" onClick={() => onOpen(link)}>
              <ExternalLink size={12} />
              Open
            </button>
            <button type="button" className="wall-link-action" data-destructive onClick={() => { onRemove(); onClose() }}>
              <Unlink size={12} />
              Remove link
            </button>
          </>
        )}
      </div>
    </form>
  )
}
