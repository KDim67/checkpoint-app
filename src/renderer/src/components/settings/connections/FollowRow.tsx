/** one workspace's line on a connection: which team or project it follows, picked from a list, and whose issues */

import React from 'react'

type Scope = 'assigned' | 'all'

interface Props {
  workspace: string
  /** the id it follows, or null */
  value: string | null
  scope: Scope
  options: { id: string; name: string }[]
  /** "Linear team", "Jira project" */
  listName: string
  /** said for a choice this computer has no name for, such as one made on another computer */
  unseenWord: string
  onSave: (id: string | null, scope: Scope) => void
}

export default function FollowRow({ workspace, value, scope, options, listName, unseenWord, onSave }: Props): React.JSX.Element {
  const unseen = value !== null && !options.some(o => o.id === value)
  return (
    <div className="connection-repo">
      <span className="text-xs-base connection-repo-name">{workspace}</span>
      <select
        className="input-xs"
        aria-label={`${listName} for ${workspace}`}
        value={value ?? ''}
        onChange={e => onSave(e.target.value || null, scope)}
      >
        <option value="">Not following</option>
        {unseen && value && <option value={value}>{unseenWord}</option>}
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <select
        className="input-xs"
        aria-label={`Which issues for ${workspace}`}
        value={scope}
        disabled={value === null}
        onChange={e => onSave(value, e.target.value === 'all' ? 'all' : 'assigned')}
      >
        <option value="assigned">Assigned to me</option>
        <option value="all">All open issues</option>
      </select>
    </div>
  )
}
