/** one workspace as a lane: who it is, what was last touched, its days around today, what's open and late, and its menu */

import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Download, FolderGit2, GitBranch, MoreHorizontal, Pencil, Trash2, UserMinus } from 'lucide-react'
import RowMenu, { type RowMenuEntry } from '../ui/RowMenu'
import ActivityStrip from './ActivityStrip'
import WorkspaceTile from './WorkspaceTile'
import { formatRelativeTime } from '../notes/notesUtils'
import { laneLabel, type Lane, type LastChange } from '../../../../shared/workspaceLanes'
import type { WorkspaceEntry } from '../../lib/createWorkspace'

export interface LaneActions {
  onSwitch: () => void
  onOpenLastChange: (change: LastChange) => void
  onEdit: (field: 'name' | 'repo') => void
  onExport: () => void
  onUnshare: () => void
  onRemove: () => void
}

interface Props extends LaneActions {
  entry: WorkspaceEntry
  lane: Lane
  /** false while the activity is still being read */
  ready: boolean
  current: boolean
  /** the one lane Tab lands on; arrows move between the rest */
  tabStop: boolean
  canRemove: boolean
  /** off while filtered: reordering part of the list would be guesswork */
  sortable: boolean
  /** true just after a drag, so the click that ends it doesn't also switch */
  settlingDrag: () => boolean
  buttonRef: (el: HTMLButtonElement | null) => void
  onFocused: () => void
}

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export default function WorkspaceLane(props: Props): React.JSX.Element {
  const { entry, lane, ready, current, tabStop, canRemove, sortable } = props
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: entry.slug, disabled: !sortable })

  const entries: RowMenuEntry[] = [
    { label: 'Rename and colour', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => props.onEdit('name') },
    { label: 'Linked repository', icon: <FolderGit2 size={14} aria-hidden="true" />, onSelect: () => props.onEdit('repo') },
    { label: 'Export', icon: <Download size={14} aria-hidden="true" />, onSelect: props.onExport },
    ...(entry.shared ? [{ label: 'Stop sharing', icon: <UserMinus size={14} aria-hidden="true" />, onSelect: props.onUnshare }] : []),
    ...(canRemove ? [{ label: 'Remove workspace', icon: <Trash2 size={14} aria-hidden="true" />, onSelect: props.onRemove, danger: true }] : [])
  ]

  const onClick = (event: React.MouseEvent): void => {
    if (props.settlingDrag()) return
    // the lane's own buttons do their own thing
    if ((event.target as Element).closest('[data-lane-action]')) return
    props.onSwitch()
  }

  const change = lane.lastChanged
  return (
    <li
      ref={setNodeRef}
      className="ws-lane"
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onClick}
      {...listeners}
    >
      <WorkspaceTile name={entry.name} color={entry.color} icon={entry.icon} />

      <div className="ws-lane-text">
        <div className="ws-lane-name">
          <button
            ref={props.buttonRef}
            type="button"
            className="ws-lane-switch"
            tabIndex={tabStop ? 0 : -1}
            aria-label={ready ? laneLabel(entry.name, lane, { current, shared: !!entry.shared }) : `${entry.name}, loading`}
            aria-current={current ? 'true' : undefined}
            onFocus={props.onFocused}
          >
            {entry.name}
          </button>
          {current && <span className="ws-badge ws-badge-here" aria-hidden="true">here</span>}
          {entry.shared && <span className="ws-badge ws-badge-shared" aria-hidden="true">shared</span>}
        </div>
        <p className="ws-lane-meta">
          {change ? (
            <>
              <span>Edited {formatRelativeTime(change.at)}</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="ws-lane-left-off"
                data-lane-action
                tabIndex={tabStop ? 0 : -1}
                title={`Switch to ${entry.name} and open it`}
                aria-label={`Open the last thing changed in ${entry.name}: ${change.title || 'Untitled'}`}
                onClick={() => props.onOpenLastChange(change)}
              >
                {change.title || 'Untitled'}
              </button>
            </>
          ) : (
            <span>{ready ? 'Nothing in it yet' : ' '}</span>
          )}
          {entry.gitPath && (
            <>
              <span aria-hidden="true">·</span>
              <span className="ws-lane-repo" title={entry.gitPath}>
                <GitBranch size={12} aria-hidden="true" />
                {folderName(entry.gitPath)}
              </span>
            </>
          )}
        </p>
      </div>

      <ActivityStrip lane={lane} />

      <div className="ws-counts" aria-hidden="true">
        {!ready ? (
          <span className="ws-count-quiet">…</span>
        ) : lane.open === 0 ? (
          <>
            <span className="ws-count-quiet">nothing</span>
            <span className="ws-count-quiet">open</span>
          </>
        ) : (
          <>
            <span>{lane.open} open</span>
            {lane.late > 0 ? <span className="ws-count-late">{lane.late} late</span> : <span className="ws-count-quiet">on time</span>}
          </>
        )}
      </div>

      <div data-lane-action>
        <RowMenu label={`More for ${entry.name}`} trigger={<MoreHorizontal size={16} aria-hidden="true" />} entries={entries} tabIndex={tabStop ? 0 : -1} />
      </div>
    </li>
  )
}
