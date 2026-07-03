import React, { useState, useEffect } from 'react'
import { Divider, ToggleSwitch } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { FolderOpen, Sparkles, AlertTriangle, Terminal } from 'lucide-react'
import { PluginInfo } from '../../../../shared/types'

export default function ExtensionsTab() {
  const { toast } = useToast()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadPluginsList = async () => {
    try {
      const enabled = await window.electronAPI.customizer.getEngineState()
      setEngineEnabled(enabled)

      const list = await window.electronAPI.customizer.getPlugins()
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
      await window.electronAPI.customizer.togglePlugin(filename, checked)
      setPlugins(prev =>
        prev.map(p => p.filename === filename ? { ...p, active: checked } : p)
      )
      toast(checked ? `Enabled plugin: ${filename}` : `Disabled plugin: ${filename}`)
    } catch (err) {
      console.error(err)
      toast(`Failed to toggle plugin: ${filename}`)
    }
  }

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.customizer.openPluginsFolder()
    } catch (err) {
      console.error(err)
      toast('Failed to open plugins directory')
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Scanning plugins…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {!engineEnabled && (
        <div style={{
          background: 'rgba(249, 115, 22, 0.1)',
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
                await window.electronAPI.customizer.toggleEngine(true)
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <Sparkles size={24} style={{ color: 'var(--color-text-faint)' }} />
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
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
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
