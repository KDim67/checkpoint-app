import React, { useState, useEffect, useCallback } from 'react'
import { copyrightYears, COPYRIGHT_HOLDER } from '../../../../shared/licence'
import { errorMessage } from '../../../../shared/errors'
import type { UpdateCheckResult } from '../../../../shared/types'
import { describeUpdateProgress } from '../../../../shared/updateEta'
import { useUpdateProgress } from '../../lib/useUpdateProgress'
import { Info, PlayCircle, RefreshCw } from 'lucide-react'
import { Divider } from './SettingsSection'
import Logo from '../ui/Logo'
import PathRow from './PathRow'
import * as appApi from '../../data/app'

/** The tone of the status line, so a failure does not read like good news. */
const UPDATE_TONE: Record<UpdateCheckResult['status'], string> = {
  unsupported: 'var(--color-text-faint)',
  current:     'var(--color-text-muted)',
  available:   'var(--color-success)',
  error:       'var(--color-error)'
}

function describeUpdate(result: UpdateCheckResult): string {
  switch (result.status) {
    case 'unsupported':
      return 'Only an installed build updates itself. This one is running from source.'
    case 'current':
      return `Checkpoint is up to date at ${result.version}.`
    case 'available':
      return `Version ${result.version} is downloading. It installs the next time you close Checkpoint.`
    case 'error':
      return result.message
  }
}

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
    electron: appApi.versions()?.electron ?? '…',
    node: appApi.versions()?.node ?? '…',
    chrome: appApi.versions()?.chrome ?? '…',
    dataPath: '…'
  })

  useEffect(() => {
    const load = async () => {
      try {
        const [version, dataPath] = await Promise.all([
          appApi.getVersion(),
          appApi.getDataPath()
        ])
        setInfo(prev => ({ ...prev, app: version, dataPath }))
      } catch (err) {
        console.error('Failed to load version info:', err)
      }
    }
    load()
  }, [])

  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  /** The same download the titlebar indicator is showing, read from one place. */
  const progress = useUpdateProgress()

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    setUpdate(null)
    try {
      setUpdate(await appApi.checkForUpdates())
    } catch (err) {
      // The handler answers with a result rather than throwing, so reaching
      // here means the channel itself failed.
      setUpdate({ status: 'error', message: errorMessage(err, 'The check could not run.') })
    } finally {
      setChecking(false)
    }
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
            A local-first desktop workspace for keeping track of what you’re doing
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
        <PathRow openTitle="Open folder" onOpen={() => appApi.openExternal(`file://${info.dataPath}`)}>
          {info.dataPath}/checkpoint.db
        </PathRow>
      </div>

      <Divider />

      {/* Actions */}
      <div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            disabled={checking}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
            onClick={checkForUpdates}
          >
            <RefreshCw size={13} className={checking ? 'animate-spin' : undefined} />
            {checking ? 'Checking…' : 'Check for Updates'}
          </button>
          <button
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
            onClick={() => appApi.openExternal('https://github.com/KDim67/checkpoint-app')}
          >
            <Info size={13} />
            GitHub Repository
          </button>
        </div>

        {/* The live line below says the same thing with a number attached, so
            only one of the two is shown. */}
        {update && !(update.status === 'available' && progress) && (
          <div
            role="status"
            style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.5,
              color: UPDATE_TONE[update.status]
            }}
          >
            {describeUpdate(update)}
          </div>
        )}

        {/* The background download in full, with the size and the time left.
            The titlebar indicator says the same thing in two words; this is
            where the rest of it goes. */}
        {progress && (
          <div
            role="status"
            style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.5,
              color: progress.phase === 'ready' ? 'var(--color-success)' : 'var(--color-text-muted)'
            }}
          >
            {describeUpdateProgress(progress)}

            {progress.phase === 'downloading' && (
              <div
                aria-hidden
                style={{
                  marginTop: '6px', height: '3px', width: '220px', maxWidth: '100%',
                  borderRadius: '999px', background: 'var(--color-surface-offset)', overflow: 'hidden'
                }}
              >
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, progress.percent))}%`,
                  borderRadius: '999px',
                  background: 'var(--color-secondary)',
                  transition: 'width 200ms linear'
                }} />
              </div>
            )}
          </div>
        )}
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
        <strong>MIT License</strong>. Copyright © {copyrightYears(new Date().getFullYear())} {COPYRIGHT_HOLDER}.
        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software to use, copy, modify, merge, publish, distribute, sublicense,
        and/or sell copies of the Software, subject to the conditions of the MIT license.
      </div>
    </div>
  )
}
