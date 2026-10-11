import React, { useEffect, useState, useRef } from 'react'
import { Wifi, Globe, Play, Loader2, RefreshCw, Terminal } from 'lucide-react'
import SettingsSection, { ToggleRow } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { WebRTCSyncCoordinator } from '../../lib/webrtcSync'
import { BAD_CODE_MESSAGE, CODE_EXAMPLE, newInternetCode, parseInternetCode } from '../../../../shared/internetPairing'
import ModalShell from '../ui/ModalShell'
import TurnRelaySettings from './TurnRelaySettings'
import { errorMessage } from '../../../../shared/errors'
import { SYNC_TCP_PORT } from '../../../../shared/ports'
import { getBoolSetting, getJsonSetting, setBoolSetting, setJsonSetting } from '../../lib/settings'
import * as syncApi from '../../data/sync'
import Presence from '../ui/Presence'

interface Peer {
  name: string
  ip: string
  port: number
  lastSeen: number
}

export default function SyncSettings() {
  const { toast } = useToast()
  
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [hostStatus, setHostStatus] = useState({
    active: false,
    port: SYNC_TCP_PORT,
    pairingCode: '',
    progress: 'Idle',
    isSyncing: false
  })
  const [discoveredPeers, setDiscoveredPeers] = useState<Peer[]>([])
  
  const [manualIp, setManualIp] = useState('')
  const [manualPort, setManualPort] = useState(String(SYNC_TCP_PORT))
  const [manualCode, setManualCode] = useState('')
  const [isManualSyncing, setIsManualSyncing] = useState(false)

  const [webrtcCode, setWebrtcCode] = useState('')
  const [webrtcInputCode, setWebrtcInputCode] = useState('')
  const [webrtcProgress, setWebrtcProgress] = useState('')
  const [isWebrtcActive, setIsWebrtcActive] = useState(false)
  const webrtcCoordinator = useRef<WebRTCSyncCoordinator | null>(null)

  const [lastSyncStats, setLastSyncStats] = useState<{
    time: number
    mode: string
    dbUpdates: number
    filesSynced: number
  } | null>(null)

  const [logs, setLogs] = useState<string[]>([])
  const [peerToPair, setPeerToPair] = useState<Peer | null>(null)
  const [passcodeVal, setPasscodeVal] = useState('')

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  const saveSyncSuccess = async (mode: string, dbUpdates: number, filesSynced: number) => {
    const stats = { time: Date.now(), mode, dbUpdates, filesSynced }
    setLastSyncStats(stats)
    await setJsonSetting('sync_last_run', stats)
  }

  useEffect(() => {
    async function loadSetting() {
      const isEnabled = await getBoolSetting('sync_enabled', false)
      setSyncEnabled(isEnabled)
      
      if (isEnabled) {
        await syncApi.startHost()
        addLog('Sync engine enabled. LAN TCP Host started.')
      }

      setLastSyncStats(await getJsonSetting('sync_last_run', null))
    }
    loadSetting()
  }, [])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (syncEnabled) {
      interval = setInterval(async () => {
        try {
          const status = await syncApi.getStatus()
          setHostStatus(status)
          if (status.progress && status.progress !== 'Idle') {
            addLog(`[LAN] ${status.progress}`)
          }

          const peers = await syncApi.getDiscoveredPeers()
          setDiscoveredPeers(peers)
        } catch {}
      }, 3000)
    }
    return () => clearInterval(interval)
  }, [syncEnabled])

  const handleToggleSync = async (checked: boolean) => {
    try {
      setSyncEnabled(checked)
      await setBoolSetting('sync_enabled', checked)
      
      if (checked) {
        await syncApi.startHost()
        addLog('Sync engine started. Discoverable on local Wi-Fi.')
        toast('Sync on')
      } else {
        await syncApi.stopHost()
        handleStopWebRTC()
        setDiscoveredPeers([])
        addLog('Sync engine disabled. All servers closed.')
        toast('Sync off')
      }
    } catch (err) {
      console.error(err)
      setSyncEnabled(!checked)
      toast(`Could not turn sync ${checked ? 'on' : 'off'}: ${errorMessage(err, 'try again')}`)
    }
  }

  const handleManualLANConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualIp || !manualCode) {
      toast('Fill in the address and the passcode from the other computer')
      return
    }

    try {
      setIsManualSyncing(true)
      addLog(`Initiating manual LAN connection to ${manualIp}:${manualPort}...`)
      
      const stats = await syncApi.connectAndSync(
        manualIp,
        parseInt(manualPort, 10) || SYNC_TCP_PORT,
        manualCode
      )
      
      addLog(`LAN Sync completed successfully! (Integrated ${stats.dbUpdates} updates)`)
      toast('Synced')
      await saveSyncSuccess('your network', stats.dbUpdates, stats.filesSynced)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      addLog(`LAN Sync failed: ${errorMsg}`)
      toast(`Couldn't sync: ${errorMsg}`)
    } finally {
      setIsManualSyncing(false)
    }
  }

  const handlePeerSync = (peer: Peer) => {
    setPasscodeVal('')
    setPeerToPair(peer)
  }

  const submitPeerPairing = async (code: string) => {
    if (!peerToPair || !code) return
    const peer = peerToPair
    setPeerToPair(null)

    addLog(`Initiating sync with discovered peer "${peer.name}" (${peer.ip})...`)
    try {
      const stats = await syncApi.connectAndSync(peer.ip, peer.port, code)
      addLog(`Sync with "${peer.name}" succeeded! (Integrated ${stats.dbUpdates} updates)`)
      toast('Synced')
      await saveSyncSuccess(peer.name, stats.dbUpdates, stats.filesSynced)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      addLog(`Sync with "${peer.name}" failed: ${errorMsg}`)
      toast(`Couldn't sync with ${peer.name}: ${errorMsg}`)
    }
  }

  // WebRTC host: wait for a peer
  const handleStartWebRTCHost = async () => {
    handleStopWebRTC()
    // its own code, not the local one: the first four characters are seen by the signalling server
    const code = newInternetCode()
    setIsWebrtcActive(true)
    setWebrtcCode(code)
    addLog('Waiting for the other computer in a new pairing room.')

    webrtcCoordinator.current = new WebRTCSyncCoordinator({
      pairingCode: code,
      isHost: true,
      onProgress: (p) => {
        setWebrtcProgress(p)
        addLog(`[WebRTC] ${p}`)
      },
      onComplete: async (stats) => {
        addLog(`[WebRTC] Sync completed successfully! (Integrated ${stats.dbUpdates} updates, ${stats.filesSynced} files)`)
        toast('Synced over the internet')
        setIsWebrtcActive(false)
        await saveSyncSuccess('the internet', stats.dbUpdates, stats.filesSynced)
      },
      onError: (err) => {
        addLog(`[WebRTC Error] ${errorMessage(err)}`)
        toast(`Couldn't sync over the internet: ${errorMessage(err)}`)
        setIsWebrtcActive(false)
      }
    })

    webrtcCoordinator.current.start()
  }

  // WebRTC client: connect to the host
  const handleStartWebRTCClient = () => {
    if (!parseInternetCode(webrtcInputCode)) {
      toast(BAD_CODE_MESSAGE)
      return
    }

    handleStopWebRTC()
    setIsWebrtcActive(true)
    setWebrtcCode(webrtcInputCode.toUpperCase())
    addLog('Joining the other computer in its pairing room.')

    webrtcCoordinator.current = new WebRTCSyncCoordinator({
      pairingCode: webrtcInputCode,
      isHost: false,
      onProgress: (p) => {
        setWebrtcProgress(p)
        addLog(`[WebRTC] ${p}`)
      },
      onComplete: async (stats) => {
        addLog(`[WebRTC] Sync completed successfully! (Integrated ${stats.dbUpdates} updates, ${stats.filesSynced} files)`)
        toast('Synced over the internet')
        setIsWebrtcActive(false)
        await saveSyncSuccess('the internet', stats.dbUpdates, stats.filesSynced)
      },
      onError: (err) => {
        addLog(`[WebRTC Error] ${errorMessage(err)}`)
        toast(`Couldn't sync over the internet: ${errorMessage(err)}`)
        setIsWebrtcActive(false)
      }
    })

    webrtcCoordinator.current.start()
  }

  const handleStopWebRTC = () => {
    if (webrtcCoordinator.current) {
      try {
        webrtcCoordinator.current.cleanup()
      } catch {}
      webrtcCoordinator.current = null
    }
    setIsWebrtcActive(false)
    setWebrtcProgress('')
    setWebrtcCode('')
  }

  const panel: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    borderRadius: 'var(--radius-md)'
  }

  return (
    <>
      <SettingsSection icon={<RefreshCw size={14} />} title="Device Sync" description="Your own computers, kept in step. Not the same as sharing a board.">
        <div className="sync-settings col-xl">
          <ToggleRow
            label="Sync this computer"
            description="Items, notes and settings, over your network or the internet. To hand a board to someone else, use Share on the board instead."
            checked={syncEnabled}
            onChange={handleToggleSync}
          />

          {lastSyncStats && (
            <div className="settings-callout" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <div className="text-label-xs-semibold">Last synced</div>
                <div className="text-sub">
                  {new Date(lastSyncStats.time).toLocaleString()} via {lastSyncStats.mode}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-5)', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="text-accent-xs-bold">{lastSyncStats.dbUpdates}</div>
                  <div className="text-sub">changes</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="text-accent-xs-bold">{lastSyncStats.filesSynced}</div>
                  <div className="text-sub">files</div>
                </div>
              </div>
            </div>
          )}

          {syncEnabled ? (
            // side by side where both fit, one above the other in a narrow window
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))', gap: 'var(--space-4)' }}>
              <div className="col-lg" data-settings-part="Local network">
                <div style={panel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Wifi size={16} className="text-accent" aria-hidden="true" />
                    <h3 className="heading-sm-bold">
                      On this network
                    </h3>
                  </div>

                  <div className="text-hint" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <span>Passcode here: <strong style={{ color: 'var(--color-secondary)', fontSize: 'var(--text-sm)', fontVariantNumeric: 'tabular-nums' }}>{hostStatus.pairingCode}</strong></span>
                    <span>Port <code className="text-base">{hostStatus.port}</code></span>
                  </div>
                  <p className="text-sub" style={{ margin: 0 }}>
                    Encrypted end to end, and the passcode itself never crosses the network. Both computers need this version of Checkpoint or later.
                  </p>

                  <h4 className="settings-list-title" style={{ margin: 0 }}>
                    Computers found ({discoveredPeers.length})
                  </h4>

                  {discoveredPeers.length === 0 ? (
                    <div className="text-sub" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      Looking… Open Checkpoint on another computer on this network.
                    </div>
                  ) : (
                    <ul className="settings-list">
                      {discoveredPeers.map(peer => (
                        <li key={`${peer.ip}:${peer.port}`} className="settings-list-row">
                          <div className="settings-row-text">
                            <div className="text-item">{peer.name}</div>
                            <div className="text-sub">{peer.ip}:{peer.port}</div>
                          </div>
                          <button type="button" className="btn-primary btn-small" onClick={() => handlePeerSync(peer)}>
                            <RefreshCw size={12} aria-hidden="true" /> Sync
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <form onSubmit={handleManualLANConnect} style={panel} aria-labelledby="sync-by-address">
                  <div>
                    <h3 id="sync-by-address" className="heading-sm-bold">
                      Connect by address
                    </h3>
                    <p className="text-sub" style={{ margin: 0 }}>
                      For a computer on a VPN such as Tailscale, or one that isn't found above.
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                    <input
                      type="text"
                      placeholder="e.g. 192.168.1.5"
                      aria-label="Address of the other computer"
                      value={manualIp}
                      onChange={e => setManualIp(e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                      className="input-md"
                      style={{ minWidth: 0 }}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Port"
                      aria-label="Port"
                      value={manualPort}
                      onChange={e => setManualPort(e.target.value)}
                      className="input-md"
                      style={{ minWidth: 0 }}
                    />
                  </div>

                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Passcode shown on the other computer"
                    aria-label="Passcode shown on the other computer"
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value)}
                    maxLength={6}
                    autoComplete="off"
                    className="input-md"
                  />

                  <button type="submit" disabled={isManualSyncing} className="btn-secondary btn-with-icon" style={{ justifyContent: 'center' }}>
                    {isManualSyncing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                    {isManualSyncing ? 'Syncing…' : 'Connect and sync'}
                  </button>
                </form>
              </div>

              <div className="col-lg" data-settings-part="Internet">
                <div style={panel}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Globe size={16} className="text-accent" aria-hidden="true" />
                    <h3 className="heading-sm-bold">
                      Over the internet
                    </h3>
                  </div>
                  <p className="text-sub" style={{ margin: 0 }}>
                    Direct and end-to-end encrypted. The last six digits of the code never leave either computer.
                  </p>

                  {isWebrtcActive ? (
                    <div className="settings-callout" role="status" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div className="row-between">
                        <span className="text-accent-xs-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          Code: {webrtcCode}
                        </span>
                        <button type="button" className="btn-ghost btn-small hover-text-error" onClick={handleStopWebRTC}>
                          Stop
                        </button>
                      </div>
                      <div className="text-hint" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
                        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                        {webrtcProgress || 'Starting…'}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="btn-primary" onClick={handleStartWebRTCHost}>
                        Show a code for the other computer
                      </button>

                      <div className="text-sub" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <div className="rule-fill" />
                        or type the code it shows
                        <div className="rule-fill" />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                        <input
                          type="text"
                          placeholder={`Code, e.g. ${CODE_EXAMPLE}`}
                          aria-label="Code from the other computer"
                          value={webrtcInputCode}
                          onChange={e => setWebrtcInputCode(e.target.value.toUpperCase())}
                          onKeyDown={e => { if (e.key === 'Enter') handleStartWebRTCClient() }}
                          maxLength={13}
                          spellCheck={false}
                          autoComplete="off"
                          className="input-md"
                          style={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
                        />
                        <button type="button" className="btn-secondary" onClick={handleStartWebRTCClient}>
                          Connect
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ ...panel, background: 'var(--color-surface-1)', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Terminal size={14} className="text-faint" aria-hidden="true" />
                    <h3 className="settings-list-title" style={{ margin: 0 }}>
                      What happened
                    </h3>
                  </div>

                  <div role="log" aria-label="Sync activity" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)', maxHeight: '9rem', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {logs.length === 0 ? (
                      <div className="text-faint">Nothing yet. Each step of a sync shows here.</div>
                    ) : (
                      logs.map((log, idx) => <div key={idx}>{log}</div>)
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Wifi size={14} aria-hidden="true" />
              Sync is off. Turn it on to find your other computers on this network, or to sync over the internet.
            </p>
          )}
        </div>
      </SettingsSection>

      <TurnRelaySettings />

      <Presence show={!!peerToPair}>
      {peerToPair && (
        <ModalShell label="Enter the passcode" onClose={() => setPeerToPair(null)} width="20rem">
          <h3 className="heading-sm-bold">
            Enter the passcode
          </h3>
          <p className="text-hint-flush">
            Type the six digits showing on <strong>{peerToPair.name}</strong>, under Device Sync.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            aria-label={`Passcode showing on ${peerToPair.name}`}
            value={passcodeVal}
            onChange={e => setPasscodeVal(e.target.value.replace(/\D/g, ''))}
            className="input-md"
            style={{
              width: '100%',
              background: 'var(--color-surface-2)',
              textAlign: 'center',
              letterSpacing: 'var(--tracking-wider)',
              fontVariantNumeric: 'tabular-nums'
            }}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && passcodeVal.length >= 5) {
                submitPeerPairing(passcodeVal)
              }
            }}
          />
          <div className="flex-gap-mt2">
            <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setPeerToPair(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={() => submitPeerPairing(passcodeVal)}
              disabled={passcodeVal.length < 5}
            >
              Connect and sync
            </button>
          </div>
        </ModalShell>
      )}
      </Presence>
    </>
  )
}
