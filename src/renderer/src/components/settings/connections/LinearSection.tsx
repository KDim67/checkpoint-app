/** Linear on the Connections tab: each workspace follows one team, and its open issues become cards */

import React from 'react'
import * as connectionsApi from '../../../data/connections'
import * as appApi from '../../../data/app'
import { useToast } from '../../ui/Toast'
import { LINEAR_KEY_PAGE } from '../../../../../shared/linear'
import type { LinearStatusView, ServiceStatusView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'
import ServiceRow from './ServiceRow'
import FollowRow from './FollowRow'

export default function LinearSection({ view, onChange }: { view: LinearStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  const save = async (slug: string, team: string | null, scope: 'assigned' | 'all'): Promise<void> => {
    const result = await connectionsApi.setTeam(slug, team, scope)
    if (result.ok) onChange(result.value)
    else toast(result.reason, { type: 'error' })
  }

  return (
    <ServiceRow
      view={view}
      icon={<ServiceLogo service="linear" />}
      summary="Open issues in each workspace's team become cards. Done, the title, the description and the due date stay in step both ways."
      steps={(
        <>
          <li>
            Make a personal API key in Linear's Security & access settings.{' '}
            <button type="button" className="connection-link" onClick={() => void appApi.openExternal(LINEAR_KEY_PAGE)}>Make a key</button>
          </li>
          <li>Paste it here. It is kept encrypted on this computer and never shown again.</li>
        </>
      )}
      keyLabel="Linear key"
      placeholder="lin_api_..."
      who={<strong>{view.login}</strong>}
      disconnectMessage="The key is forgotten on this computer. Your cards stay, but stop following their issues until you connect again."
      onChange={onChange}
    >
      {view.workspaces.map(ws => (
        <FollowRow
          key={ws.slug}
          workspace={ws.name}
          value={ws.team}
          scope={ws.scope}
          options={view.teams}
          listName="Linear team"
          unseenWord="A team this computer hasn't seen"
          onSave={(team, scope) => void save(ws.slug, team, scope)}
        />
      ))}
    </ServiceRow>
  )
}
