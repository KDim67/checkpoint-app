/** services Checkpoint keeps cards in step with, each through a key you make in that service; a key goes in and never comes back */

import React, { useCallback, useEffect, useState } from 'react'
import * as connectionsApi from '../../data/connections'
import type { ServiceStatusView } from '../../../../shared/connections'
import GitHubSection from './connections/GitHubSection'
import TodoistSection from './connections/TodoistSection'
import LinearSection from './connections/LinearSection'
import JiraSection from './connections/JiraSection'
import NotionSection from './connections/NotionSection'
import ObsidianSection from './connections/ObsidianSection'
import { SettingsCardSkeleton } from './SettingsSection'

export default function ConnectionsSettings(): React.JSX.Element {
  const [views, setViews] = useState<ServiceStatusView[] | null>(null)

  const load = useCallback(async () => {
    try {
      setViews(await connectionsApi.list())
    } catch (err) {
      console.error('Failed to load connections:', err)
      setViews([])
    }
  }, [])

  useEffect(() => {
    void load()
    return connectionsApi.onChanged(() => { void load() })
  }, [load])

  const replace = (view: ServiceStatusView): void =>
    setViews(current => (current ?? []).map(v => (v.service === view.service ? view : v)))

  if (views === null) return <SettingsCardSkeleton label="Loading your connections" rows={2} />
  // each service is a card of its own, spaced like the cards on every other page
  return (
    <>
      {views.map(view => {
        if (view.service === 'github') return <GitHubSection key={view.service} view={view} onChange={replace} />
        if (view.service === 'todoist') return <TodoistSection key={view.service} view={view} onChange={replace} />
        if (view.service === 'linear') return <LinearSection key={view.service} view={view} onChange={replace} />
        if (view.service === 'jira') return <JiraSection key={view.service} view={view} onChange={replace} />
        if (view.service === 'notion') return <NotionSection key={view.service} view={view} onChange={replace} />
        return <ObsidianSection key={view.service} view={view} onChange={replace} />
      })}
    </>
  )
}
