import React, { useCallback, useEffect, useState } from 'react'
import { Divider, ToggleSwitch } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { FolderOpen, Sparkles, AlertTriangle, Terminal, ShieldCheck, X } from 'lucide-react'
import type { PluginInfo, PluginLogLine } from '../../../../shared/types'
import { PERMISSION_TEXT, type PluginStatus } from '../../../../shared/pluginPermissions'
import { EXAMPLE_PLUGINS } from '../../../../shared/examplePlugins'
import * as customizerApi from '../../data/customizer'
import { useAppStore } from '../../store/appStore'
import PluginConsentModal from './PluginConsentModal'
import PluginSettingsModal from './PluginSettingsModal'

const STATUS_LABEL: Record<PluginStatus, string> = {
  off: 'Off',
  starting: 'Starting',
  running: 'Running',
  'needs-approval': 'Needs your OK',
  stopped: 'Stopped',
  crashed: 'Crashed'
}

// a plugin can stop or crash while the tab is open
const REFRESH_MS = 5000

const TEMPLATE = `/** @type {import('./checkpoint-plugin').Plugin} */
module.exports = {
  metadata: {
    name: "Hello",
    description: "Says hello when something is finished.",
    version: "1.0.0",
    permissions: ["read", "notify"]
  },
  onLoad(api) {
    api.events.on("item:completed", ({ item }) => {
      api.notify("Done", item.title)
    })
  }
}`

/** granted when there is a grant, otherwise what it asks for */
function permissionSummary(plugin: PluginInfo): string {
  const list = plugin.grant?.permissions ?? plugin.request.permissions
  if (list.length === 0) return 'Asks for nothing'
  return list.map(p => PERMISSION_TEXT[p].label).join(', ')
}

const approvedOn = (p: PluginInfo): string =>
  p.grant && p.grant.grantedAt > 0 ? ` on ${new Date(p.grant.grantedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''

export default function ExtensionsTab() {
  const { toast } = useToast()
  const workspaceList = useAppStore(s => s.workspaceList)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ name: string; message: string } | null>(null)
  const [reviewing, setReviewing] = useState<PluginInfo | null>(null)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<PluginInfo | null>(null)
  const [logLines, setLogLines] = useState<PluginLogLine[]>([])

  const loadPluginsList = useCallback(async () => {
    try {
      setEngineEnabled(await customizerApi.getEngineState())
      setPlugins(await customizerApi.getPlugins())
    } catch (err) {
      console.error('Failed to load plugins:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPluginsList()
    const timer = setInterval(() => void loadPluginsList(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadPluginsList])

  // refreshed with the list, so a plugin's output shows up while you watch
  useEffect(() => {
    if (!openLog) return
    const load = () => customizerApi.getPluginLog(openLog).then(setLogLines).catch(console.error)
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [openLog])

  const handleToggle = async (plugin: PluginInfo, checked: boolean) => {
    if (checked) {
      // never on without seeing what it asks for
      setReviewing(plugin)
      return
    }
    try {
      await customizerApi.disablePlugin(plugin.filename)
      setLoadError(current => (current?.name === plugin.name ? null : current))
      await loadPluginsList()
      toast(`Turned off ${plugin.name}`)
    } catch (err) {
      console.error(err)
      toast(`Couldn't turn off ${plugin.name}`)
    }
  }

  const handleApprove = async (plugin: PluginInfo, workspaces: string[]): Promise<boolean> => {
    try {
      const result = await customizerApi.approvePlugin(plugin.filename, {
        permissions: plugin.request.permissions,
        hosts: plugin.request.hosts,
        workspaces
      })
      await loadPluginsList()
      if (!result.ok) {
        // the switch stays where it is with the reason; a plugin that failed to start never looks on
        setLoadError({ name: plugin.name, message: result.error ?? 'It failed to start.' })
        return true
      }
      setLoadError(current => (current?.name === plugin.name ? null : current))
      toast(engineEnabled ? `${plugin.name} is on` : `${plugin.name} will run once the Customization Engine is on`)
      return true
    } catch (err) {
      console.error(err)
      toast(`Couldn't turn on ${plugin.name}`)
      return false
    }
  }

  const handleInstallExample = async (filename: string) => {
    try {
      const result = await customizerApi.installExample(filename)
      if (!result.ok) {
        toast(result.error ?? 'Could not install that example')
        return
      }
      // rescan so the file shows with metadata from disk
      await loadPluginsList()
      toast(`Installed ${filename}. Read it, then turn it on below.`)
    } catch (err) {
      console.error(err)
      toast('Could not install that example')
    }
  }

  const handleOpenFolder = async () => {
    try {
      await customizerApi.openPluginsFolder()
    } catch (err) {
      console.error(err)
      toast('Failed to open plugins directory')
    }
  }

  if (loading) {
    return <div className="text-sm-faint">Scanning plugins…</div>
  }

  // on before plugins were sandboxed; main hides that grant, so it shows as on with none
  const paused = plugins.filter(p => p.active && p.status === 'needs-approval' && p.grant === null)

  return (
    <div className="col-xl">
      <div className="plugin-notice">
        <ShieldCheck size={16} className="plugin-notice-icon" />
        <div>
          Each plugin runs in its own sandbox and can only do what you allow when you turn it on: see or
          change cards in the workspaces you pick, notify you, or reach the sites it lists. Approvals are
          for this computer only.
        </div>
      </div>

      {paused.length > 0 && (
        <div className="plugin-notice plugin-notice-warning">
          <AlertTriangle size={16} className="plugin-notice-icon" />
          <div>
            {paused.length === 1 ? `${paused[0].name} is` : `${paused.length} plugins you had on are`} paused.
            Plugins now run in a sandbox, so each needs your OK for what it asks for.
          </div>
        </div>
      )}

      {loadError && (
        <div className="plugin-notice plugin-notice-error" role="alert">
          <AlertTriangle size={16} className="plugin-notice-icon" />
          <div className="fill">
            <div className="plugin-notice-title">{loadError.name} didn't start</div>
            <code className="plugin-error-text">{loadError.message}</code>
          </div>
          <button className="btn-secondary" onClick={() => setLoadError(null)} aria-label="Dismiss the plugin error">
            <X size={12} />
          </button>
        </div>
      )}

      {!engineEnabled && (
        <div className="plugin-notice plugin-notice-warning">
          <AlertTriangle size={16} className="plugin-notice-icon" />
          <div className="fill">
            The Customization Engine is off, so no plugin runs. It also powers the Theme Builder in <strong>Appearance &amp; Theme</strong>.
          </div>
          <button
            className="plugin-engine-button"
            onClick={async () => {
              try {
                await customizerApi.toggleEngine(true)
                await loadPluginsList()
                toast('Customization Engine activated')
              } catch (err) {
                console.error(err)
                toast('Failed to enable the Customization Engine')
              }
            }}
          >
            Enable now
          </button>
        </div>
      )}

      <div className="row-between">
        <div>
          <h3 className="heading-sm-strong">User Plugins</h3>
          <p className="text-sub">JavaScript files from your plugins folder, each in its own sandbox.</p>
        </div>
        <button onClick={handleOpenFolder} className="extensions-tab-open-folder">
          <FolderOpen size={12} />
          Open Plugins Folder
        </button>
      </div>

      <div className="col">
        <div>
          <div className="text-item">Example plugins</div>
          <div className="text-sub">
            Written into your plugins folder so you can read them before turning anything on.
            Installing does not switch a plugin on.
          </div>
        </div>

        {EXAMPLE_PLUGINS.map(example => {
          const installed = plugins.some(plugin => plugin.filename === example.filename)
          return (
            <div key={example.filename} className="plugin-example">
              <div className="fill">
                <div className="text-xs-base">{example.name}</div>
                <div className="plugin-example-description">{example.description}</div>
              </div>
              <button className="btn-secondary" disabled={installed} onClick={() => handleInstallExample(example.filename)}>
                {installed ? 'Installed' : 'Install'}
              </button>
            </div>
          )
        })}
      </div>

      <Divider />

      <div className="plugin-list" data-engine={engineEnabled ? 'on' : 'off'}>
        {plugins.length === 0 ? (
          <div className="plugin-empty">
            <Sparkles size={24} className="text-faint" />
            <div className="text-item">No plugins found in the plugins directory</div>
            <div className="text-sub">
              Create a JavaScript file (for example <code>hello.js</code>) in the plugins folder. A plugin lists
              what it needs in <code>permissions</code>, and the sites it talks to in <code>hosts</code>.
            </div>
            <pre className="plugin-template">
              <div className="plugin-template-name">
                <Terminal size={12} />
                <span>hello.js</span>
              </div>
              {TEMPLATE}
            </pre>
          </div>
        ) : (
          plugins.map(p => (
            <div key={p.filename} className="plugin-row">
              <div className="fill">
                <div className="row">
                  <span className="text-item-strong">{p.name}</span>
                  <span className="plugin-version">v{p.version}</span>
                  <span className="plugin-status" data-status={p.status}>{STATUS_LABEL[p.status]}</span>
                </div>
                <p className="plugin-description">{p.description}</p>
                {p.statusDetail && <p className="plugin-status-detail" data-status={p.status}>{p.statusDetail}</p>}
                {p.changed && (
                  <p className="plugin-status-detail" data-status="changed">
                    Its code changed since you approved it{approvedOn(p)}. It asks for nothing more, so it still runs. Review it to accept the change.
                  </p>
                )}
                <div className="plugin-meta">
                  <span>{permissionSummary(p)}</span>
                  {(p.grant?.hosts ?? p.request.hosts).length > 0 && (
                    <span>Sites: {(p.grant?.hosts ?? p.request.hosts).join(', ')}</span>
                  )}
                  <code>{p.filename}</code>
                </div>
              </div>

              <div className="plugin-row-actions">
                {p.settings.length > 0 && (
                  <button className="btn-ghost" onClick={() => setConfiguring(p)}>Settings</button>
                )}
                <button
                  className="btn-ghost"
                  aria-expanded={openLog === p.filename}
                  onClick={() => {
                    setLogLines([])
                    setOpenLog(current => (current === p.filename ? null : p.filename))
                  }}
                >
                  Log
                </button>
                {p.active && (
                  <button className="btn-ghost" onClick={() => setReviewing(p)}>
                    {p.status === 'needs-approval' || p.changed ? 'Review' : 'Permissions'}
                  </button>
                )}
                {/* you want it on; the pill says whether it actually runs, so a paused one can still be switched off */}
                <ToggleSwitch
                  checked={p.active}
                  onChange={checked => void handleToggle(p, checked)}
                  label={`Turn on ${p.name}`}
                />
              </div>

              {openLog === p.filename && (
                <div className="plugin-log" role="log" aria-label={`What ${p.name} logged`}>
                  {logLines.length === 0
                    ? <div className="plugin-log-empty">Nothing logged since Checkpoint started. Lines from api.log and its errors show here.</div>
                    : logLines.map((line, i) => (
                      <div key={`${line.at}-${i}`} className="plugin-log-line" data-level={line.level}>
                        <time>{new Date(line.at).toLocaleTimeString()}</time>
                        <span>{line.text}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {configuring && (
        <PluginSettingsModal
          plugin={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={() => toast(`Saved the settings for ${configuring.name}`)}
        />
      )}

      {reviewing && (
        <PluginConsentModal
          plugin={reviewing}
          workspaces={workspaceList}
          activeWorkspace={activeWorkspace}
          onClose={() => setReviewing(null)}
          onApprove={workspaces => handleApprove(reviewing, workspaces)}
        />
      )}
    </div>
  )
}
