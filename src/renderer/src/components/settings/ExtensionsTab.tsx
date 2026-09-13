import React, { useState, useEffect } from 'react'
import { Divider, ToggleSwitch } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { FolderOpen, Sparkles, AlertTriangle, Terminal, ShieldAlert, X } from 'lucide-react'
import { PluginInfo } from '../../../../shared/types'
import { EXAMPLE_PLUGINS } from '../../../../shared/examplePlugins'
import * as customizerApi from '../../data/customizer'

export default function ExtensionsTab() {
  const { toast } = useToast()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ filename: string; message: string } | null>(null)

  const loadPluginsList = async () => {
    try {
      const enabled = await customizerApi.getEngineState()
      setEngineEnabled(enabled)

      const list = await customizerApi.getPlugins()
      setPlugins(list)
    } catch (err) {
      console.error('Failed to load plugins:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPluginsList()
  }, [])

  const handleTogglePlugin = async (filename: string, checked: boolean) => {
    try {
      const result = await customizerApi.togglePlugin(filename, checked)
      if (!result.ok) {
        // The switch stays off and the reason is shown. Previously a plugin that
        // threw on load was recorded as enabled and failed silently every launch.
        setLoadError({ filename, message: result.error ?? 'The plugin failed to load.' })
        toast(`${filename} could not be enabled`)
        return
      }
      setLoadError(current => (current?.filename === filename ? null : current))
      setPlugins(prev =>
        prev.map(p => p.filename === filename ? { ...p, active: checked } : p)
      )
      toast(checked ? `Enabled plugin: ${filename}` : `Disabled plugin: ${filename}`)
    } catch (err) {
      console.error(err)
      toast(`Failed to toggle plugin: ${filename}`)
    }
  }

  const handleInstallExample = async (filename: string) => {
    try {
      const result = await customizerApi.installExample(filename)
      if (!result.ok) {
        toast(result.error ?? 'Could not install that example')
        return
      }
      // Re-scanned rather than assumed: the list is what the folder actually
      // holds, and the new file should appear with its metadata read from disk.
      await loadPluginsList()
      toast(`Installed ${filename}. Read it, then enable it below.`)
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
    return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Scanning plugins…</div>
  }

  return (
    <div className="col-xl">
      {/* Plugins are required into the main process, so they run with the app's
          full privileges. Saying so plainly is the honest thing: the engine's
          own description used to call them "sandboxed", which they are not. */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)'
      }}>
        <ShieldAlert size={16} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 'var(--leading-relaxed)' }}>
          A plugin runs inside Checkpoint with the same access the app has. Your
          files, your database and the network. Only enable code you have read or
          trust. Nothing here is sandboxed.
        </div>
      </div>

      {loadError && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-error-muted)',
          border: '1px solid var(--color-error)',
          borderRadius: 'var(--radius-lg)'
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: '1px' }} />
          <div className="fill">
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', fontWeight: 'var(--weight-semibold)' }}>
              {loadError.filename} could not be enabled
            </div>
            <code style={{
              display: 'block',
              marginTop: 'var(--space-1)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {loadError.message}
            </code>
          </div>
          <button
            className="btn-secondary"
            onClick={() => setLoadError(null)}
            aria-label="Dismiss the plugin error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {!engineEnabled && (
        <div style={{
          background: 'var(--color-warning-muted)',
          border: '1px solid var(--color-warning)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)'
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', flex: 1 }}>
            The Customization Engine is disabled, so plugin hooks are inactive. It also powers the Theme Builder in <strong>Appearance &amp; Theme</strong>.
          </div>
          <button
            onClick={async () => {
              try {
                await customizerApi.toggleEngine(true)
                setEngineEnabled(true)
                toast('Customization Engine activated')
              } catch (err) {
                console.error(err)
                toast('Failed to enable the Customization Engine')
              }
            }}
            style={{
              flexShrink: 0,
              background: 'var(--color-warning)',
              border: 'none',
              color: '#0b0c10',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              cursor: 'pointer'
            }}
          >
            Enable now
          </button>
        </div>
      )}

      <div className="row-between">
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-semibold)' }}>
            User Plugins
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Hot-load custom javascript plugins to expand Checkpoint's backend.
          </p>
        </div>

        <button
          onClick={handleOpenFolder}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            cursor: 'pointer',
            transition: 'all 100ms ease'
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-surface-offset)'}
        >
          <FolderOpen size={12} />
          Open Plugins Folder
        </button>
      </div>

      <div className="col">
        <div>
          <div className="text-item">
            Example plugins
          </div>
          <div className="text-sub">
            Written into your plugins folder so you can read them before enabling anything.
            Installing does not switch a plugin on.
          </div>
        </div>

        {EXAMPLE_PLUGINS.map(example => {
          const installed = plugins.some(plugin => plugin.filename === example.filename)
          return (
            <div
              key={example.filename}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)'
              }}
            >
              <div className="fill">
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>{example.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '1px' }}>
                  {example.description}
                </div>
              </div>
              <button
                className="btn-secondary"
                disabled={installed}
                onClick={() => handleInstallExample(example.filename)}
                style={{ flexShrink: 0, opacity: installed ? 0.5 : 1 }}
              >
                {installed ? 'Installed' : 'Install'}
              </button>
            </div>
          )
        })}
      </div>

      <Divider />

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        opacity: engineEnabled ? 1 : 0.6,
        pointerEvents: engineEnabled ? 'auto' : 'none',
        transition: 'opacity 200ms ease'
      }}>
        {plugins.length === 0 ? (
          <div style={{
            background: 'var(--color-surface-2)',
            border: '1px dashed var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-6)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-3)'
          }}>
            <Sparkles size={24} className="text-faint" />
            <div className="text-item">
              No plugins found in the plugins directory
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: '440px', lineHeight: 'var(--leading-relaxed)' }}>
              Create a javascript file (e.g., <code>hello.js</code>) inside the plugins folder.
              Here is a template you can use to start developing:
            </div>
            <pre style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-muted)',
              textAlign: 'left',
              width: '100%',
              maxWidth: '520px',
              overflowX: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-secondary)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '4px', marginBottom: '6px' }}>
                <Terminal size={12} />
                <span>plugin-template.js</span>
              </div>
              {`module.exports = {
  metadata: {
    name: "Console Greeter",
    description: "Logs a welcoming message on startup.",
    version: "1.0.0"
  },
  onLoad(api) {
    api.log("Custom plugin loaded successfully!");
  },
  onUnload() {
    console.log("Custom plugin unloaded!");
  }
};`}
            </pre>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-3)' }}>
            {plugins.map(p => (
              <div
                key={p.filename}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
                  <div className="row">
                    <span className="text-item-strong">
                      {p.name}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      background: 'var(--color-surface-2)',
                      color: 'var(--color-text-muted)',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid var(--color-surface-offset)'
                    }}>
                      v{p.version}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {p.description}
                  </p>
                  <code style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', display: 'block', marginTop: '6px' }}>
                    File: {p.filename}
                  </code>
                </div>

                <ToggleSwitch
                  checked={p.active}
                  onChange={checked => handleTogglePlugin(p.filename, checked)}
                  label={`Enable plugin ${p.name || p.filename}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
