import React, { useState, useEffect, useCallback } from 'react'
import { copyrightYears, COPYRIGHT_HOLDER } from '../../../../shared/licence'
import { errorMessage } from '../../../../shared/errors'
import type { UpdateCheckResult } from '../../../../shared/types'
import { describeUpdateProgress } from '../../../../shared/updateEta'
import { useUpdateProgress } from '../../lib/useUpdateProgress'
import WhatsNew from './WhatsNew'
import { Bug, FileText, Info, Newspaper, PlayCircle, RefreshCw } from 'lucide-react'
import ServiceLogo from '../ui/ServiceLogo'
import { REPOSITORY } from '../../../../shared/releaseNotes'
import { openProblemReport } from '../../lib/reportProblem'
import SettingsSection, { Divider } from './SettingsSection'
import Logo from '../ui/Logo'
import PathRow from './PathRow'
import * as appApi from '../../data/app'

/** so a failure doesn't read like good news */
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
  /** same source as the titlebar indicator */
  const progress = useUpdateProgress()

  const checkForUpdates = useCallback(async () => {
    setChecking(true)
    setUpdate(null)
    try {
      setUpdate(await appApi.checkForUpdates())
    } catch (err) {
      // the handler returns results, so this means the channel itself failed
      setUpdate({ status: 'error', message: errorMessage(err, 'The check could not run.') })
    } finally {
      setChecking(false)
    }
  }, [])

  const versions = [
    { label: 'Electron',         value: info.electron },
    { label: 'Node.js',          value: info.node },
    { label: 'Chromium',         value: info.chrome }
  ]

  return (
    <>
      <SettingsSection icon={<Info size={14} />} title="Checkpoint" description="The version you have, and where to turn when something's wrong.">
        <div className="col-xl">
          <div className="row-lg">
            <Logo size={48} />
            <div className="fill">
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
                Checkpoint
              </div>
              <div className="text-hint-faint">
                A local-first desktop workspace for keeping track of what you’re doing
              </div>
            </div>
            <span className="plugin-version" style={{ fontVariantNumeric: 'tabular-nums' }}>App version {info.app}</span>
          </div>

          <Divider />

          <div className="col-md">
            <div className="row-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div className="settings-row-text">
                <div className="text-item">Updates</div>
                <div className="text-sub">Checkpoint looks for a new version on its own, and installs it when you close the app.</div>
              </div>
              <button
                type="button"
                className="btn-secondary btn-with-icon"
                disabled={checking}
                onClick={checkForUpdates}
              >
                <RefreshCw size={14} aria-hidden="true" className={checking ? 'animate-spin' : undefined} />
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>

            {/* the live line below already says it with a number */}
            {update && !(update.status === 'available' && progress) && (
              <div
                role="status"
                style={{
                  fontSize: 'var(--text-xs)',
                  lineHeight: 'var(--leading-normal)',
                  color: UPDATE_TONE[update.status]
                }}
              >
                {describeUpdate(update)}
              </div>
            )}

            {/* full download detail, the titlebar says it in two words */}
            {progress && (
              <div
                role="status"
                style={{
                  fontSize: 'var(--text-xs)',
                  lineHeight: 'var(--leading-normal)',
                  color: progress.phase === 'ready' ? 'var(--color-success)' : 'var(--color-text-muted)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span>{describeUpdateProgress(progress)}</span>
                  {progress.phase === 'ready' && (
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      onClick={() => void appApi.installUpdate()}
                    >
                      Restart now
                    </button>
                  )}
                </div>

                {progress.phase === 'downloading' && (
                  <div
                    aria-hidden
                    style={{
                      marginTop: 'var(--space-1-5)', height: '3px', width: '14rem', maxWidth: '100%',
                      borderRadius: 'var(--radius-full)', background: 'var(--color-surface-offset)', overflow: 'hidden'
                    }}
                  >
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, progress.percent))}%`,
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-secondary)',
                      transition: 'width var(--duration-normal) linear'
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* first-run replay lives here, where people ask what the app is */}
          <div className="row-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="settings-row-text">
              <div className="text-item">
                Getting started
              </div>
              <div className="text-sub">
                The welcome panel, with the keyboard shortcuts worth knowing.
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary btn-with-icon"
              onClick={() => window.dispatchEvent(new CustomEvent('replay-onboarding'))}
            >
              <PlayCircle size={14} aria-hidden="true" />
              Show again
            </button>
          </div>

          <div className="col-md">
            <div>
              <div className="text-item">Something wrong?</div>
              <div className="text-sub">
                Report a problem fills in GitHub's bug form with the version and recent errors, for you to read before sending.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary btn-with-icon" onClick={() => openProblemReport()}>
                <Bug size={14} aria-hidden="true" />
                Report a problem
              </button>
              {/* every error the app recorded, which Report a problem quotes the end of */}
              <button
                type="button"
                className="btn-secondary btn-with-icon"
                onClick={() => void appApi.showAppLog().catch(err => console.error('Could not show the app log:', err))}
              >
                <FileText size={14} aria-hidden="true" />
                Show the app log
              </button>
              {/* for a bug report: every check, download, install and error, with times */}
              <button
                type="button"
                className="btn-secondary btn-with-icon"
                onClick={() => void appApi.showUpdateLog().catch(err => console.error('Could not show the update log:', err))}
              >
                <FileText size={14} aria-hidden="true" />
                Show the update log
              </button>
              <button type="button" className="btn-secondary btn-with-icon" onClick={() => appApi.openExternal(REPOSITORY)}>
                <ServiceLogo service="github" size={14} />
                Open on GitHub
              </button>
            </div>
          </div>

          <Divider />

          <div className="col-md">
            <div className="text-item">Database location</div>
            <PathRow openTitle="Open the data folder" onOpen={() => appApi.openExternal(`file://${info.dataPath}`)}>
              {`${info.dataPath}/checkpoint.db`}
            </PathRow>
            <dl className="settings-list" style={{ margin: 0 }}>
              {versions.map(v => (
                <div key={v.label} className="settings-list-row" style={{ padding: 'var(--space-2) var(--space-4)' }}>
                  <dt className="text-hint">{v.label}</dt>
                  <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontVariantNumeric: 'tabular-nums' }}>
                    {v.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="text-sub" style={{ margin: 0, lineHeight: 'var(--leading-relaxed)' }}>
            <strong>MIT License</strong>. Copyright © {copyrightYears(new Date().getFullYear())} {COPYRIGHT_HOLDER}.
            Permission is hereby granted, free of charge, to any person obtaining a copy
            of this software to use, copy, modify, merge, publish, distribute, sublicense,
            and/or sell copies of the Software, subject to the conditions of the MIT license.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Newspaper size={14} />} title="What's New" description="What changed in each version, from the release notes on GitHub.">
        <WhatsNew />
      </SettingsSection>
    </>
  )
}
