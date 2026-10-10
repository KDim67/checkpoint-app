/** Jira on the Connections tab: each workspace follows one project, and its open issues become cards */

import React from 'react'
import * as connectionsApi from '../../../data/connections'
import * as appApi from '../../../data/app'
import { useToast } from '../../ui/Toast'
import { JIRA_KEY_PAGE } from '../../../../../shared/jira'
import type { JiraStatusView, ServiceStatusView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'
import ServiceRow from './ServiceRow'
import FollowRow from './FollowRow'

export default function JiraSection({ view, onChange }: { view: JiraStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  const save = async (slug: string, project: string | null, scope: 'assigned' | 'all'): Promise<void> => {
    const result = await connectionsApi.setJiraProject(slug, project, scope)
    if (result.ok) onChange(result.value)
    else toast(result.reason, { type: 'error' })
  }

  return (
    <ServiceRow
      view={view}
      icon={<ServiceLogo service="jira" />}
      summary="Open issues in each workspace's Jira Cloud project become cards. Done, the title and the due date stay in step both ways; the description comes from Jira."
      steps={(
        <>
          <li>
            Make an API token for your Atlassian account.{' '}
            <button type="button" className="connection-link" onClick={() => void appApi.openExternal(JIRA_KEY_PAGE)}>Make a token</button>
          </li>
          <li>Fill in your Jira address, the email you sign in with, and the token. They are kept encrypted on this computer, and the token is never shown again.</li>
        </>
      )}
      fields={[
        { name: 'site', label: 'Jira address', placeholder: 'yourname.atlassian.net' },
        { name: 'email', label: 'Atlassian email', placeholder: 'Email', type: 'email' },
        { name: 'token', label: 'Jira API token', placeholder: 'API token', secret: true }
      ]}
      who={<><strong>{view.login}</strong>{view.site ? ` on ${new URL(view.site).hostname}` : ''}</>}
      disconnectMessage="The token is forgotten on this computer. Your cards stay, but stop following their issues until you connect again."
      onChange={onChange}
    >
      {view.workspaces.map(ws => (
        <FollowRow
          key={ws.slug}
          workspace={ws.name}
          value={ws.project}
          scope={ws.scope}
          options={view.projects}
          listName="Jira project"
          unseenWord="A project this computer hasn't seen"
          onSave={(project, scope) => void save(ws.slug, project, scope)}
        />
      ))}
    </ServiceRow>
  )
}
