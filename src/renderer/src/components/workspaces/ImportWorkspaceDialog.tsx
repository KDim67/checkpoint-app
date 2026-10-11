/** a picked file waiting for its name: what's in it, and a warning before a Checkpoint file merges into a workspace that exists */

import React, { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import ModalShell from '../ui/ModalShell'
import { slugifyWorkspace } from '../../lib/createWorkspace'
import type { ImportDraft, Outcome } from './useWorkspaces'

interface Props {
  draft: ImportDraft
  taken: string[]
  onSubmit: (name: string) => Promise<Outcome>
  onClose: () => void
}

function contents(draft: ImportDraft): string {
  if (draft.kind === 'board') {
    const source = draft.board.source === 'todoist' ? 'Todoist' : 'Trello'
    return `From ${source}: ${draft.board.columns.length} columns and ${draft.board.cards.length} cards.`
  }
  const { items = [], tags = [], relations = [] } = draft.payload
  return `${items.length} items, ${tags.length} tags and ${relations.length} links.`
}

export default function ImportWorkspaceDialog({ draft, taken, onSubmit, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(draft.name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const slug = slugifyWorkspace(name)
  const merges = draft.kind === 'checkpoint' && taken.includes(slug)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const outcome = await onSubmit(name)
      if (outcome.ok) onClose()
      else setError(outcome.reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell label="Import a workspace" onClose={onClose} width="var(--ws-form-width)" closeOnBackdrop={false}>
      <form className="ws-form" onSubmit={submit} noValidate>
        <h2 className="ws-form-title">Import a workspace</h2>
        <p className="ws-field-hint">{contents(draft)}</p>
        {draft.kind === 'board' && draft.board.notes.length > 0 && (
          <ul className="ws-field-hint">
            {draft.board.notes.map(note => <li key={note}>{note}</li>)}
          </ul>
        )}

        <div className="ws-field">
          <label className="field-label" htmlFor="ws-import-name">Name</label>
          <input
            id="ws-import-name"
            className="input-base"
            value={name}
            autoFocus
            onChange={event => { setName(event.target.value); setError('') }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'ws-import-error' : 'ws-import-slug'}
          />
          {error ? (
            <p id="ws-import-error" className="ws-field-error" role="alert">{error}</p>
          ) : (
            slug && <p id="ws-import-slug" className="ws-field-hint">Short name #{slug}</p>
          )}
        </div>

        {merges && (
          <div className="ws-warning" role="note">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>#{slug} already exists. The file's items go into it, replacing any it shares with the workspace, and its board settings replace the workspace's.</span>
          </div>
        )}

        <div className="ws-form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" aria-busy={busy}>{busy ? 'Importing…' : merges ? 'Import into it' : 'Import'}</button>
        </div>
      </form>
    </ModalShell>
  )
}
