import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { FilePlus, Paperclip } from 'lucide-react'
import * as appApi from '../../data/app'

export type CardAttachment = { id: string; name: string; path: string; isImage: boolean; createdAt: number }

interface CardAttachmentsProps {
  attachments: CardAttachment[]
  isReadOnly: boolean
  dragging: boolean
  setDragging: Dispatch<SetStateAction<boolean>>
  linkName: string
  setLinkName: Dispatch<SetStateAction<string>>
  linkUrl: string
  setLinkUrl: Dispatch<SetStateAction<string>>
  onAttachFiles: (files: FileList | File[]) => void
  onAddLink: (name: string, url: string) => void
  onFileChosen: (e: ChangeEvent<HTMLInputElement>) => void
  onSetCover: (urlOrPath: string) => void
  onRemove: (attachment: CardAttachment) => void
}

export default function CardAttachments({
  attachments,
  isReadOnly,
  dragging,
  setDragging,
  linkName,
  setLinkName,
  linkUrl,
  setLinkUrl,
  onAttachFiles,
  onAddLink,
  onFileChosen,
  onSetCover,
  onRemove
}: CardAttachmentsProps) {
  // The whole section is the drop target, not just the button: dragging a
  // file at a small button is a worse version of clicking it.
  return (
    <div
      onDragOver={e => {
        if (isReadOnly) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={e => {
        // Fires when crossing into a child, so only a leave that actually
        // exits the section counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={e => {
        // First, and whatever the drop turns out to be. Letting a drop
        // run its default is how a window navigates to what was dropped
        // on it, and a card modal replaced by a text file is not a state
        // there is a way back from.
        e.preventDefault()
        setDragging(false)
        if (isReadOnly || e.dataTransfer.files.length === 0) return
        onAttachFiles(e.dataTransfer.files)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        borderTop: '1px solid var(--color-surface-offset)',
        paddingTop: 'var(--space-4)',
        marginTop: 'var(--space-2)',
        outline: dragging ? '2px dashed var(--color-secondary)' : 'none',
        outlineOffset: 'var(--space-2)',
        borderRadius: 'var(--radius-md)'
      }}
    >
      <span style={{ fontSize: '11px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Paperclip size={13} className="text-accent" />
        Attachments
        <span style={{ fontWeight: 'var(--weight-regular)', textTransform: 'none', color: 'var(--color-text-faint)' }}>
          {dragging ? 'drop to attach' : 'or drop files here'}
        </span>
      </span>

      {/* List of Attachments */}
      {attachments.length > 0 && (
        <div className="grid-2">
          {attachments.map(att => (
            <div
              key={att.id}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-2)'
              }}
            >
              <div className="col-fill">
                <span
                  title={att.path}
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-text-base)',
                    fontWeight: 'var(--weight-medium)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    if (att.path.startsWith('http://') || att.path.startsWith('https://')) {
                      window.open(att.path, '_blank')
                    } else {
                      appApi.showItemInFolder(att.path)
                    }
                  }}
                >
                  {att.name}
                </span>
              </div>

              <div className="row-4px">
                {att.isImage && (
                  <button
                    onClick={() => onSetCover(att.path)}
                    title="Set as Card Cover"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-secondary)',
                      fontSize: '9px',
                      cursor: 'pointer',
                      padding: '2px'
                    }}
                  >
                    Cover
                  </button>
                )}
                <button
                  onClick={() => onRemove(att)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text-faint)', cursor: 'pointer', padding: '2px' }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Attachment Forms */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px', flex: 1, minWidth: '220px' }}>
          <input
            type="text"
            placeholder="Link URL..."
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            style={{
              flex: 2,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 6px',
              fontSize: '11px',
              outline: 'none'
            }}
          />
          <input
            type="text"
            placeholder="Name (optional)..."
            value={linkName}
            onChange={e => setLinkName(e.target.value)}
            style={{
              flex: 1,
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 6px',
              fontSize: '11px',
              outline: 'none',
              minWidth: 0
            }}
          />
          <button
            onClick={() => {
              onAddLink(linkName, linkUrl)
              setLinkName('')
              setLinkUrl('')
            }}
            style={{
              background: 'var(--color-surface-offset)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-base)',
              fontSize: '10px',
              fontWeight: 'var(--weight-semibold)',
              padding: '3px 8px',
              cursor: 'pointer'
            }}
          >
            Link
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => document.getElementById('card-file-uploader')?.click()}
            style={{
              background: 'var(--color-surface-offset)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-base)',
              fontSize: '10px',
              fontWeight: 'var(--weight-semibold)',
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <FilePlus size={12} />
            <span>Attach Local File</span>
          </button>
          <input
            type="file"
            id="card-file-uploader"
            className="is-hidden"
            onChange={onFileChosen}
          />
        </div>
      </div>
    </div>
  )
}
