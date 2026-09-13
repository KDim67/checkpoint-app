import type { Dispatch, SetStateAction } from 'react'
import { Clock } from 'lucide-react'
import { authorLabel } from '@shared/identity'
import { changeSentence, visibleCardHistory, type CardChange } from '@shared/cardHistory'
import { handleImageDrop, handleImagePaste } from '../../lib/mediaHelper'

export type CardComment = { id: string; user: string; text: string; createdAt: number }

interface CardDiscussionProps {
  comments: CardComment[]
  activities: CardChange[]
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  onPost: () => void
  onDelete: (commentId: string) => void
}

export default function CardDiscussion({ comments, activities, draft, setDraft, onPost, onDelete }: CardDiscussionProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 'var(--space-5)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
      
      {/* Comments Thread */}
      <div className="col-md">
        <span className="label-caps">
          Discussion
        </span>

        {/* Post comment input */}
        <div className="col-4px">
          <textarea
            placeholder="Write a comment..."
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onPaste={async (e) => {
              const isImage = await handleImagePaste(e, draft, setDraft)
              if (isImage) return
            }}
            onDrop={async (e) => {
              await handleImageDrop(e, draft, setDraft)
            }}
            onDragOver={e => e.preventDefault()}
            rows={2}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              color: 'var(--color-text-base)',
              fontSize: 'var(--text-xs)',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'none'
            }}
          />
          <button
            onClick={onPost}
            disabled={!draft.trim()}
            style={{
              alignSelf: 'flex-end',
              background: 'var(--color-secondary)',
              border: 'none',
              color: 'var(--color-text-inverted)',
              fontWeight: 'var(--weight-bold)',
              fontSize: '10px',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              opacity: draft.trim() ? 1 : 0.5
            }}
          >
            Save Comment
          </button>
        </div>

        {/* Comments Feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: '200px', overflowY: 'auto' }}>
          {comments.map(c => (
            <div
              key={c.id}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div className="row-between">
                <strong style={{ fontSize: '10px', color: 'var(--color-secondary)' }}>{authorLabel(c.user)}</strong>
                <div className="row-6px">
                  <span style={{ fontSize: '8px', color: 'var(--color-text-faint)' }}>
                    {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <button
                    onClick={() => onDelete(c.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', fontSize: '9px', padding: 0 }}
                  >
                    delete
                  </button>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-base)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                {c.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Activities Trail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderLeft: '1px solid var(--color-surface-offset)', paddingLeft: 'var(--space-4)' }}>
        <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Clock size={11} className="text-faint" />
          Activity History
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto' }}>
          {visibleCardHistory(activities).map(act => (
            <div key={act.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
                {changeSentence(act)}
              </span>
              {act.at > 0 && (
                <span style={{ fontSize: '8px', color: 'var(--color-text-faint)' }}>
                  {new Date(act.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>
          ))}
          {visibleCardHistory(activities).length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No changes yet.</span>
          )}
        </div>
      </div>

    </div>
  )
}
