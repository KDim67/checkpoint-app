/** GitHub on the Connections tab: open issues in each workspace's repository become cards */

import React, { useEffect, useState } from 'react'
import * as connectionsApi from '../../../data/connections'
import * as appApi from '../../../data/app'
import { useToast } from '../../ui/Toast'
import { GITHUB_KEY_PAGE } from '../../../../../shared/github'
import type { GitHubStatusView, ServiceStatusView, WorkspaceRepoView } from '../../../../../shared/connections'
import ServiceLogo from '../../ui/ServiceLogo'
import ServiceRow from './ServiceRow'

const dateOf = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

function RepoRow({ repo, onSaved }: { repo: WorkspaceRepoView; onSaved: (view: ServiceStatusView) => void }): React.JSX.Element {
  const { toast } = useToast()
  // the field holds only a repository picked here; one found from the folder shows as its placeholder
  const chosen = repo.source === 'chosen' ? repo.repo ?? '' : ''
  const [draft, setDraft] = useState(chosen)
  useEffect(() => setDraft(chosen), [chosen])

  const save = async (nextRepo: string, scope: WorkspaceRepoView['scope']): Promise<void> => {
    const result = await connectionsApi.setRepo(repo.slug, nextRepo.trim() || null, scope)
    if (result.ok) onSaved(result.value)
    else {
      toast(result.reason, { type: 'error' })
      setDraft(chosen)
    }
  }

  const where = repo.source === 'folder'
    ? 'From the workspace\'s folder.'
    : repo.repo ? null : 'Not following a repository. Type one, or give the workspace a folder that has one.'

  return (
    <div className="connection-repo">
      <span className="text-xs-base connection-repo-name">{repo.name}</span>
      <input
        className="input-xs connection-repo-input"
        aria-label={`Repository for ${repo.name}`}
        placeholder={repo.source === 'folder' && repo.repo ? repo.repo : 'owner/repo'}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== chosen) void save(draft, repo.scope) }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
      <select
        className="input-xs"
        aria-label={`Which issues for ${repo.name}`}
        value={repo.scope}
        onChange={e => void save(draft, e.target.value === 'all' ? 'all' : 'assigned')}
      >
        <option value="assigned">Assigned to me</option>
        <option value="all">All open issues</option>
      </select>
      {where && <span className="text-sub connection-repo-note">{where}</span>}
      {repo.readOnly && (
        <span className="connection-repo-note connection-warning">This key can only read {repo.repo}'s issues, so moving a card to Done won't close them.</span>
      )}
    </div>
  )
}

export default function GitHubSection({ view, onChange }: { view: GitHubStatusView; onChange: (view: ServiceStatusView) => void }): React.JSX.Element {
  return (
    <ServiceRow
      view={view}
      icon={<ServiceLogo service="github" />}
      summary="Open issues in each workspace's repository become cards. Moving a card to Done closes its issue, and an issue closed or reopened on GitHub moves its card."
      steps={(
        <>
          <li>
            Make a fine-grained key on GitHub. Pick the repositories it may use, and give it <strong>Issues: Read and write</strong>.{' '}
            <button type="button" className="connection-link" onClick={() => void appApi.openExternal(GITHUB_KEY_PAGE)}>Make a key</button>
          </li>
          <li>Paste it here. It is kept encrypted on this computer and never shown again.</li>
        </>
      )}
      keyLabel="GitHub key"
      placeholder="github_pat_..."
      who={<strong>@{view.login}</strong>}
      more={view.expiresAt !== null ? ` The key works until ${dateOf(view.expiresAt)}.` : undefined}
      disconnectMessage="The key is forgotten on this computer. Your cards stay, but stop following their issues until you connect again."
      onChange={onChange}
    >
      {view.repos.map(repo => <RepoRow key={repo.slug} repo={repo} onSaved={onChange} />)}
    </ServiceRow>
  )
}
