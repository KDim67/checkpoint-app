/** Todoist on the Connections tab: each workspace follows one project, and its open tasks become cards */

import React from 'react'
import * as connectionsApi from '../../../data/connections'
import * as appApi from '../../../data/app'
import { useToast } from '../../ui/Toast'
import { TODOIST_KEY_PAGE } from '../../../../../shared/todoist'
import type { ServiceStatusView, TodoistProject, TodoistStatusView, WorkspaceProjectView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'
import ServiceRow from './ServiceRow'

function ProjectRow({ workspace, projects, onSaved }: { workspace: WorkspaceProjectView; projects: TodoistProject[]; onSaved: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  // picked on another computer, or a project since archived: kept, and said plainly
  const unseen = workspace.project !== null && !projects.some(p => p.id === workspace.project)

  const save = async (project: string | null): Promise<void> => {
    const result = await connectionsApi.setProject(workspace.slug, project)
    if (result.ok) onSaved(result.value)
    else toast(result.reason, { type: 'error' })
  }

  return (
    <div className="connection-repo">
      <span className="text-xs-base connection-repo-name">{workspace.name}</span>
      <select
        className="input-xs connection-project-select"
        aria-label={`Todoist project for ${workspace.name}`}
        value={workspace.project ?? ''}
        onChange={e => void save(e.target.value || null)}
      >
        <option value="">Not following</option>
        {unseen && workspace.project && <option value={workspace.project}>A project this computer hasn't seen</option>}
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

export default function TodoistSection({ view, onChange }: { view: TodoistStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  return (
    <ServiceRow
      view={view}
      icon={<ServiceLogo service="todoist" />}
      summary="Open tasks in each workspace's project become cards. Done, the title, the description and the date stay in step both ways; a repeating task's date stays Todoist's."
      steps={(
        <>
          <li>
            Open Todoist's developer settings and copy your <strong>API token</strong>.{' '}
            <button type="button" className="connection-link" onClick={() => void appApi.openExternal(TODOIST_KEY_PAGE)}>Open Todoist</button>
          </li>
          <li>Paste it here. It is kept encrypted on this computer and never shown again.</li>
        </>
      )}
      keyLabel="Todoist API token"
      placeholder="API token"
      who={<strong>{view.login}</strong>}
      disconnectMessage="The token is forgotten on this computer. Your cards stay, but stop following their tasks until you connect again."
      onChange={onChange}
    >
      {view.workspaces.map(ws => <ProjectRow key={ws.slug} workspace={ws} projects={view.projects} onSaved={onChange} />)}
    </ServiceRow>
  )
}
