/** Notion on the Connections tab: each workspace follows one database, and its pages that aren't done become cards */

import React from 'react'
import * as connectionsApi from '../../../data/connections'
import * as appApi from '../../../data/app'
import { useToast } from '../../ui/Toast'
import { NOTION_KEY_PAGE } from '../../../../../shared/notion'
import type { NotionStatusView, ServiceStatusView, WorkspaceNotionView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'
import ServiceRow from './ServiceRow'

interface Choice {
  source: string | null
  done?: string | null
  date?: string | null
}

function DatabaseRow({ workspace, sources, onSave }: { workspace: WorkspaceNotionView; sources: NotionStatusView['sources']; onSave: (choice: Choice) => void }): React.JSX.Element {
  const unseen = workspace.source !== null && !sources.some(s => s.id === workspace.source)
  const nameOf = (options: WorkspaceNotionView['doneOptions'], id: string | null): string | null => options.find(o => o.id === id)?.name ?? null
  const doneName = nameOf(workspace.doneOptions, workspace.done)
  const dateName = nameOf(workspace.dateOptions, workspace.date)
  // a choice to make only when there is one; otherwise a line saying what was found
  const found = workspace.source && !workspace.problem && workspace.doneOptions.length <= 1 && workspace.dateOptions.length <= 1
    ? `Done is ${doneName ?? 'not found'}${dateName ? `, the date is ${dateName}` : ', and there is no date column'}.`
    : null

  return (
    <div className="connection-repo">
      <span className="text-xs-base connection-repo-name">{workspace.name}</span>
      <select
        className="input-xs connection-project-select"
        aria-label={`Notion database for ${workspace.name}`}
        value={workspace.source ?? ''}
        onChange={e => onSave({ source: e.target.value || null })}
      >
        <option value="">Not following</option>
        {unseen && workspace.source && <option value={workspace.source}>A database this computer hasn't seen</option>}
        {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {workspace.source && workspace.doneOptions.length > 1 && (
        <select
          className="input-xs connection-repo-note"
          aria-label={`Done column for ${workspace.name}`}
          value={workspace.done ?? ''}
          onChange={e => onSave({ source: workspace.source, done: e.target.value, date: workspace.date })}
        >
          {workspace.doneOptions.map(o => <option key={o.id} value={o.id}>Done is {o.name}</option>)}
        </select>
      )}
      {workspace.source && workspace.dateOptions.length > 1 && (
        <select
          className="input-xs connection-repo-note"
          aria-label={`Date column for ${workspace.name}`}
          value={workspace.date ?? ''}
          onChange={e => onSave({ source: workspace.source, done: workspace.done, date: e.target.value })}
        >
          {workspace.dateOptions.map(o => <option key={o.id} value={o.id}>The date is {o.name}</option>)}
        </select>
      )}
      {found && <span className="text-sub connection-repo-note">{found}</span>}
      {workspace.problem && <span className="connection-repo-note connection-warning">{workspace.problem}</span>}
    </div>
  )
}

export default function NotionSection({ view, onChange }: { view: NotionStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  const save = async (slug: string, choice: Choice): Promise<void> => {
    const result = await connectionsApi.setNotionDatabase(slug, choice.source, choice.done, choice.date)
    if (result.ok) onChange(result.value)
    else toast(result.reason, { type: 'error' })
  }

  return (
    <ServiceRow
      view={view}
      icon={<ServiceLogo service="notion" />}
      summary="Pages that aren't done in each workspace's database become cards. Done, the title and the date stay in step both ways; the card's description stays its own."
      steps={(
        <>
          <li>
            Make an internal integration in Notion and copy its secret.{' '}
            <button type="button" className="connection-link" onClick={() => void appApi.openExternal(NOTION_KEY_PAGE)}>Open Notion</button>
          </li>
          <li>In Notion, open each database you want here, and add the integration under the ••• menu, Connections.</li>
          <li>Paste the secret here. It is kept encrypted on this computer and never shown again.</li>
        </>
      )}
      keyLabel="Notion secret"
      placeholder="ntn_..."
      who={<strong>{view.login}</strong>}
      disconnectMessage="The secret is forgotten on this computer. Your cards stay, but stop following their pages until you connect again."
      onChange={onChange}
    >
      {view.sources.length === 0 && view.lastOk !== null && (
        <p className="text-sub">No databases are shared with the integration yet. Add it to a database in Notion, then Sync now.</p>
      )}
      {view.workspaces.map(ws => <DatabaseRow key={ws.slug} workspace={ws} sources={view.sources} onSave={choice => void save(ws.slug, choice)} />)}
    </ServiceRow>
  )
}
