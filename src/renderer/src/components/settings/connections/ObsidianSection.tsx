/** Obsidian on the Connections tab: no key, just a folder per workspace on this computer, whose unticked tasks become cards */

import React, { useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import * as connectionsApi from '../../../data/connections'
import { useToast } from '../../ui/Toast'
import type { ObsidianStatusView, ServiceStatusView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'

const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function ObsidianSection({ view, onChange }: { view: ObsidianStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const following = view.workspaces.filter(w => w.folder !== null).length

  const pick = async (slug: string): Promise<void> => {
    setBusy(slug)
    try {
      const result = await connectionsApi.pickFolder(slug)
      if (result.ok) onChange(result.value)
      else toast(result.reason, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const stop = async (slug: string): Promise<void> => {
    setBusy(slug)
    try {
      onChange(await connectionsApi.clearFolder(slug))
    } finally {
      setBusy(null)
    }
  }

  const checkNow = async (): Promise<void> => {
    setBusy('check')
    try {
      onChange(await connectionsApi.syncNow('obsidian'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="connection-row" role="group" aria-label="Obsidian">
      <div className="connection-head">
        <ServiceLogo service="obsidian" />
        <span className="text-item-strong">Obsidian</span>
        <span className="plugin-status" data-status={!view.connected ? 'off' : view.problem ? 'needs-approval' : 'running'}>
          {!view.connected ? 'Not following' : view.problem ? 'Needs a look' : 'Following'}
        </span>
      </div>
      <p className="text-sub">
        Unticked tasks in each workspace's vault folder become cards. Done ticks the box in the note, and the title and date go both ways. Checkpoint adds a short block id to each task it follows, and changes only that task's line.
      </p>
      {view.connected && (
        <p className="text-sub">
          Following {following === 1 ? 'one folder' : `${following} folders`} on this computer.
          {view.lastOk !== null ? ` Last checked at ${timeOf(view.lastOk)}.` : ' Checking for the first time...'}
        </p>
      )}
      {view.problem && <p className="connection-problem" role="alert">{view.problem}</p>}
      <div className="connection-repos">
        {view.workspaces.map(ws => (
          <div key={ws.slug} className="connection-repo">
            <span className="text-xs-base connection-repo-name">{ws.name}</span>
            <span className="text-sub connection-folder" title={ws.folder ?? undefined}>{ws.folder ?? 'Not following a folder'}</span>
            <span className="row-4px">
              <button type="button" className="btn-secondary" disabled={busy !== null} aria-label={`Choose a folder for ${ws.name}`} onClick={() => void pick(ws.slug)}>
                <span className="row-4px"><FolderOpen size={13} aria-hidden="true" />{ws.folder ? 'Change' : 'Choose folder'}</span>
              </button>
              {ws.folder && (
                <button type="button" className="btn-ghost" disabled={busy !== null} aria-label={`Stop following ${ws.name}'s folder`} onClick={() => void stop(ws.slug)}>
                  Stop following
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {view.connected && (
        <div className="connection-actions">
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void checkNow()}>
            <span className="row-4px"><RefreshCw size={13} aria-hidden="true" className={busy === 'check' ? 'animate-spin' : undefined} />Check now</span>
          </button>
        </div>
      )}
    </div>
  )
}
