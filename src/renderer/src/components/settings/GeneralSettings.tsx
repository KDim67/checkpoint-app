import { useState, useEffect } from 'react'
import { FieldRow, SettingsSelect } from './SettingsSection'
import { VIEW_FEATURES, readViewFeatures, defaultViewEnabledMap, START_VIEW_LAST_USED, type ViewEnabledMap } from '../../lib/features'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import { useAppStore } from '../../store/appStore'
import { workspaceName } from '../../lib/createWorkspace'

export default function GeneralSettings() {
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)
  const workspaceList = useAppStore(s => s.workspaceList)

  const [defaultContext, setDefaultContext] = useState<string>('')
  const [startView, setStartView] = useState<string>(START_VIEW_LAST_USED)
  const [enabledViews, setEnabledViews] = useState<ViewEnabledMap>(defaultViewEnabledMap)

  useEffect(() => {
    const load = async () => {
      setDefaultContext(await getStringSetting('default_context', ''))
      setStartView(await getStringSetting('start_view', START_VIEW_LAST_USED))
      setEnabledViews(await readViewFeatures())
    }
    load().catch(err => console.error('Failed to load general settings:', err))
  }, [])

  return (
    <div className="col-xl">
      <FieldRow
        label="Startup workspace"
        hint="The workspace Checkpoint opens on. Last used picks up where you left off."
      >
        <SettingsSelect
          value={defaultContext}
          onChange={e => {
            setDefaultContext(e.target.value)
            setStringSetting('default_context', e.target.value)
          }}
        >
          <option value="">Last used</option>
          {availableWorkspaces.map(ctx => (
            <option key={ctx} value={ctx}>{workspaceName(ctx, workspaceList)}</option>
          ))}
        </SettingsSelect>
      </FieldRow>

      <FieldRow
        label="Startup view"
        hint="The screen Checkpoint opens on. Only views that are turned on are listed."
      >
        <SettingsSelect
          value={startView}
          onChange={e => {
            setStartView(e.target.value)
            setStringSetting('start_view', e.target.value).catch(err => {
              console.error('Failed to save start_view setting:', err)
            })
          }}
        >
          <option value={START_VIEW_LAST_USED}>Last used</option>
          {VIEW_FEATURES.filter(f => enabledViews[f.view]).map(f => (
            <option key={f.view} value={f.view}>{f.label}</option>
          ))}
        </SettingsSelect>
      </FieldRow>
    </div>
  )
}
