/** taking a workspace out of the list, which keeps its items; said plainly, since "delete" would promise more than happens */

import React, { useEffect, useState } from 'react'
import ModalShell from '../ui/ModalShell'
import { countItems } from '../../data/items'
import type { WorkspaceEntry } from '../../lib/createWorkspace'

interface Props {
  entry: WorkspaceEntry
  onConfirm: () => void
  onClose: () => void
}

export default function RemoveWorkspaceDialog({ entry, onConfirm, onClose }: Props): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([countItems(entry.slug, 'card'), countItems(entry.slug, 'task')])
      .then(([cards, tasks]) => { if (!cancelled) setCount(cards + tasks) })
      .catch(() => { if (!cancelled) setCount(-1) })
    return () => { cancelled = true }
  }, [entry.slug])

  // the number while it's being counted, or if it can't be, is simply left out
  const kept = count === null || count < 0 ? 'Its cards and tasks' : `Its ${count} card${count === 1 ? '' : 's'} and task${count === 1 ? '' : 's'}`

  return (
    <ModalShell label={`Remove ${entry.name}`} onClose={onClose} width="var(--ws-form-width)" closeOnBackdrop={false}>
      <div className="ws-form">
        <h2 className="ws-form-title">Remove {entry.name}?</h2>
        <p className="ws-field-hint">
          {kept} stay in the database. Undo brings it straight back, or add a workspace with the short name #{entry.slug} later to see them again.
        </p>
        <div className="ws-form-actions">
          <button type="button" className="btn-secondary" onClick={onClose} autoFocus>Cancel</button>
          <button type="button" className="btn-danger" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </ModalShell>
  )
}
