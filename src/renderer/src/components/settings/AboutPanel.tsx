import React, { useState, useEffect } from 'react'
import { ExternalLink, FolderOpen, Info, PlayCircle } from 'lucide-react'
import { Divider } from './SettingsSection'
import Logo from '../ui/Logo'

interface VersionInfo {
  app: string
  electron: string
  node: string
  chrome: string
  dataPath: string
}

export default function AboutPanel() {
  const [info, setInfo] = useState<VersionInfo>({
    app: '…',
    electron: window.electronAPI.app.versions?.electron ?? '…',
    node: window.electronAPI.app.versions?.node ?? '…',
    chrome: window.electronAPI.app.versions?.chrome ?? '…',
    dataPath: '…'
  })

  useEffect(() => {
    const load = async () => {
      try {
        const [version, dataPath] = await Promise.all([
          window.electronAPI.app.getVersion(),
          window.electronAPI.app.getDataPath()
        ])
        setInfo(prev => ({ ...prev, app: version, dataPath }))
      } catch (err) {
        console.error('Failed to load version info:', err)
      }
    }
    load()
  }, [])

  const versions = [
    { label: 'App Version',      value: info.app },
    { label: 'Electron',         value: info.electron },
    { label: 'Node.js',          value: info.node },
    { label: 'Chromium',         value: info.chrome }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Brand header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Logo size={48} />
        <div>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
            Checkpoint
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
            Developer productivity workspace
          </div>
        </div>
      </div>

      <Divider />

      {/* Replay of the first-run panel. Lives here rather than in Appearance
          because this is where someone looks when they want to know what the
          app is, which is the same question the panel answers. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Getting started
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            The welcome panel, with the keyboard shortcuts worth knowing.
          </div>
        </div>
        <button
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', flexShrink: 0 }}
          onClick={() => window.dispatchEvent(new CustomEvent('replay-onboarding'))}
        >
          <PlayCircle size={13} />
          Show again
        </button>
      </div>

      <Divider />

      {/* Version table */}
      <div className="col">
        {versions.map(v => (
          <div
            key={v.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{v.label}</span>
            <code style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-base)'
            }}>
              {v.value}
            </code>
          </div>
        ))}
      </div>

      {/* Database path */}
      <div>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
          Database Location
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)'
        }}>
          <code style={{
            flex: 1,
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {info.dataPath}/checkpoint.db
          </code>
          <button
            className="btn-icon"
            title="Open folder"
            style={{ width: '28px', height: '28px', flexShrink: 0 }}
            onClick={() => window.electronAPI.app.openExternal(`file://${info.dataPath}`)}
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </div>

      <Divider />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <button
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
          onClick={() => window.electronAPI.app.openExternal('https://github.com/checkpoint-app/checkpoint/releases')}
        >
          <ExternalLink size={13} />
          Check for Updates
        </button>
        <button
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
          onClick={() => window.electronAPI.app.openExternal('https://github.com/checkpoint-app/checkpoint')}
        >
          <Info size={13} />
          GitHub Repository
        </button>
      </div>

      {/* License notice */}
      <div style={{
        fontSize: '11px',
        color: 'var(--color-text-faint)',
        lineHeight: 1.6,
        padding: 'var(--space-3)',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-surface-offset)'
      }}>
        <strong>MIT License</strong>. Copyright © 2025 Checkpoint Contributors.
        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software to use, copy, modify, merge, publish, distribute, sublicense,
        and/or sell copies of the Software, subject to the conditions of the MIT license.
      </div>
    </div>
  )
}
