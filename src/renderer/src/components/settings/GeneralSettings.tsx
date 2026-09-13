import { useState, useEffect } from 'react'
import { FieldRow } from './SettingsSection'
import { VIEW_FEATURES, readViewFeatures, defaultViewEnabledMap, START_VIEW_LAST_USED, type ViewEnabledMap } from '../../lib/features'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import { useAppStore } from '../../store/appStore'

export default function GeneralSettings() {
  const availableWorkspaces = useAppStore(s => s.availableWorkspaces)

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
        label="Startup Workspace"
        hint="The workspace loaded when the app starts. Choose “Last used” to always resume where you left off."
      >
        <select
          value={defaultContext}
          onChange={e => {
            setDefaultContext(e.target.value)
            setStringSetting('default_context', e.target.value)
          }}
          className="select-md"
        >
          <option value="">Last used (default)</option>
          {availableWorkspaces.map(ctx => (
            <option key={ctx} value={ctx}>{ctx}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow
        label="Startup View"
        hint="The screen shown when the app opens. Disabled views are not listed, and a view turned off later falls back to the first one still enabled."
      >
        <select
          value={startView}
          onChange={e => {
            setStartView(e.target.value)
            setStringSetting('start_view', e.target.value).catch(err => {
              console.error('Failed to save start_view setting:', err)
            })
          }}
          className="select-md"
        >
          <option value={START_VIEW_LAST_USED}>Last used (default)</option>
          {VIEW_FEATURES.filter(f => enabledViews[f.view]).map(f => (
            <option key={f.view} value={f.view}>{f.label}</option>
          ))}
        </select>
      </FieldRow>
    </div>
  )
}
