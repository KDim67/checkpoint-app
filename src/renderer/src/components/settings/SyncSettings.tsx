import React, { useEffect, useState, useRef } from 'react'
import { Wifi, Globe, Play, Loader2, RefreshCw, Terminal } from 'lucide-react'
import { useToast } from '../ui/Toast'
import { WebRTCSyncCoordinator } from '../../lib/webrtcSync'
import ModalShell from '../ui/ModalShell'
import TurnRelaySettings from './TurnRelaySettings'
import { errorMessage } from '../../../../shared/errors'
import { SYNC_TCP_PORT } from '../../../../shared/ports'
import { getBoolSetting, getJsonSetting, setBoolSetting, setJsonSetting } from '../../lib/settings'
import * as syncApi from '../../data/sync'

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
        toast('Sync server active')
      } else {
        await syncApi.stopHost()
        handleStopWebRTC()
        setDiscoveredPeers([])
        addLog('Sync engine disabled. All servers closed.')
        toast('Sync server stopped')
      }
    } catch (err) {
      console.error(err)
      toast('Failed to change sync state')
    }
  }

  const handleManualLANConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualIp || !manualCode) {
      toast('Please enter target IP/Host and Passcode')
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
      toast('Sync successful')
      await saveSyncSuccess('LAN (Manual)', stats.dbUpdates, stats.filesSynced)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      addLog(`LAN Sync failed: ${errorMsg}`)
      toast('Sync failed')
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
      toast('Sync successful')
      await saveSyncSuccess(`LAN (${peer.name})`, stats.dbUpdates, stats.filesSynced)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      addLog(`Sync with "${peer.name}" failed: ${errorMsg}`)
      toast('Sync failed')
    }
  }

  // WebRTC host: wait for a peer
  const handleStartWebRTCHost = async () => {
    if (!hostStatus.pairingCode) {
      toast('Please enable Sync Engine first')
      return
    }
    
    handleStopWebRTC()
    setIsWebrtcActive(true)
    setWebrtcCode(hostStatus.pairingCode)
    addLog(`Starting WebRTC Host session with pairing code: ${hostStatus.pairingCode}`)

    webrtcCoordinator.current = new WebRTCSyncCoordinator({
      pairingCode: hostStatus.pairingCode,
      isHost: true,
      onProgress: (p) => {
        setWebrtcProgress(p)
        addLog(`[WebRTC] ${p}`)
      },
      onComplete: async (stats) => {
        addLog(`[WebRTC] Sync completed successfully! (Integrated ${stats.dbUpdates} updates, ${stats.filesSynced} files)`)
        toast('Internet sync completed')
        setIsWebrtcActive(false)
        await saveSyncSuccess('Internet', stats.dbUpdates, stats.filesSynced)
      },
      onError: (err) => {
        addLog(`[WebRTC Error] ${errorMessage(err)}`)
        toast('Internet sync failed')
        setIsWebrtcActive(false)
      }
    })

    webrtcCoordinator.current.start()
  }

  // WebRTC client: connect to the host
  const handleStartWebRTCClient = () => {
    if (!webrtcInputCode || webrtcInputCode.length !== 6) {
      toast('Please enter a valid 6-digit passcode')
      return
    }

    handleStopWebRTC()
    setIsWebrtcActive(true)
    setWebrtcCode(webrtcInputCode)
    addLog(`Starting WebRTC Client session to passcode: ${webrtcInputCode}`)

    webrtcCoordinator.current = new WebRTCSyncCoordinator({
      pairingCode: webrtcInputCode,
      isHost: false,
      onProgress: (p) => {
        setWebrtcProgress(p)
        addLog(`[WebRTC] ${p}`)
      },
      onComplete: async (stats) => {
        addLog(`[WebRTC] Sync completed successfully! (Integrated ${stats.dbUpdates} updates, ${stats.filesSynced} files)`)
        toast('Internet sync completed')
        setIsWebrtcActive(false)
        await saveSyncSuccess('Internet', stats.dbUpdates, stats.filesSynced)
      },
      onError: (err) => {
        addLog(`[WebRTC Error] ${errorMessage(err)}`)
        toast('Internet sync failed')
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

  return (
    <div className="sync-settings" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-4)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', margin: 0 }}>
            Device Sync
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: '4px', marginBottom: 0 }}>
            Keeps your own machines in step: items, notes and settings, over your network or the internet. To hand a board to another person, use Share on the board instead.
          </p>
        </div>

        <label className="toggle-switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={e => handleToggleSync(e.target.checked)}
            className="is-hidden"
          />
          <span
            style={{
              position: 'relative',
              width: '44px',
              height: '24px',
              background: syncEnabled ? 'var(--color-success)' : 'var(--color-surface-offset)',
              borderRadius: '12px',
              transition: 'background var(--duration-fast) ease',
              display: 'inline-block'
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '2px',
                left: syncEnabled ? '22px' : '2px',
                width: '20px',
                height: '20px',
                background: 'var(--color-surface-1)',
                borderRadius: '50%',
                boxShadow: 'var(--shadow-sm)',
                transition: 'left var(--duration-fast) ease'
              }}
            />
          </span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: syncEnabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            {syncEnabled ? 'Active' : 'Disabled'}
          </span>
        </label>
      </div>

      {lastSyncStats && (
        <div style={{
          background: 'var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: '1px solid var(--color-surface-offset)'
        }}>
          <div>
            <div className="text-label-xs">
              Last Sync Succeeded
            </div>
            <div style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
              Completed {new Date(lastSyncStats.time).toLocaleString()} via {lastSyncStats.mode}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)' }}>
            <div style={{ textAlign: 'right' }}>
              <div className="text-accent-xs-bold">
                {lastSyncStats.dbUpdates}
              </div>
              <div style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-muted)' }}>
                DB Merges
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="text-accent-xs-bold">
                {lastSyncStats.filesSynced}
              </div>
              <div style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-muted)' }}>
                Files Synced
              </div>
            </div>
          </div>
        </div>
      )}

      {syncEnabled ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          <div className="col-lg">
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <Wifi size={18} className="text-accent" />
                <h3 className="heading-sm-bold">
                  Local LAN Sync (Wi-Fi)
                </h3>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                <span>Host Port: <code className="text-base">{hostStatus.port}</code></span>
                <span>LAN Passcode: <strong style={{ color: 'var(--color-secondary)', fontSize: 'var(--text-sm)' }}>{hostStatus.pairingCode}</strong></span>
              </div>

              <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
                Available LAN Peers ({discoveredPeers.length})
              </h4>
              
              {discoveredPeers.length === 0 ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', padding: 'var(--space-3) 0', borderTop: '1px solid var(--color-surface-offset)' }}>
                  Searching local subnet... Open Checkpoint on your other machine.
                </div>
              ) : (
                <div className="col">
                  {discoveredPeers.map((peer, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-3)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
                      <div>
                        <div className="text-label-xs">{peer.name}</div>
                        <div style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-faint)' }}>{peer.ip}:{peer.port}</div>
                      </div>
                      <button
                        onClick={() => handlePeerSync(peer)}
                        style={{
                          background: 'var(--color-secondary)',
                          color: 'var(--color-surface-1)',
                          border: 'none',
                          fontSize: 'var(--text-xxs)',
                          fontWeight: 'var(--weight-semibold)',
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <RefreshCw size={10} /> Sync
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handleManualLANConnect} style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', margin: 0 }}>
                Manual Connect (LAN / VPN)
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.5 or Tailscale IP"
                  value={manualIp}
                  onChange={e => setManualIp(e.target.value)}
                  className="input-xs"
                />
                <input
                  type="text"
                  placeholder="Port"
                  value={manualPort}
                  onChange={e => setManualPort(e.target.value)}
                  className="input-xs"
                />
              </div>

              <input
                type="text"
                placeholder="6-Digit Passcode"
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                maxLength={6}
                className="input-xs"
              />

              <button
                type="submit"
                disabled={isManualSyncing}
                className="border-offset hover-border-accent"
                style={{
                  background: 'var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  padding: '8px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  transition: 'all var(--duration-fast)'
                }}
              >
                {isManualSyncing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Connect & Sync
              </button>
            </form>
          </div>

          <div className="col-lg">
            <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                <Globe size={18} className="text-accent" />
                <h3 className="heading-sm-bold">
                  Internet Sync (WebRTC)
                </h3>
              </div>
              <p style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-faint)', margin: 0 }}>
                Direct peer-to-peer data channel. Bypasses local routers. Securely encrypted.
              </p>

              {isWebrtcActive ? (
                <div style={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div className="row-between">
                    <span className="text-accent-xs-bold">
                      Active WebRTC Room: {webrtcCode}
                    </span>
                    <button
                      onClick={handleStopWebRTC}
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: 'var(--text-xxs)', fontWeight: 'var(--weight-semibold)' }}
                    >
                      Disconnect
                    </button>
                  </div>
                  <div style={{ fontSize: 'var(--text-xxs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Loader2 size={10} className="animate-spin" />
                    {webrtcProgress || 'Initializing...'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                  <button
                    onClick={handleStartWebRTCHost}
                    style={{
                      background: 'var(--color-secondary)',
                      color: 'var(--color-surface-1)',
                      border: 'none',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    Generate Internet Share Link
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xxs)', color: 'var(--color-text-faint)' }}>
                    <div className="rule-fill" />
                    OR CONNECT TO PEER
                    <div className="rule-fill" />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                    <input
                      type="text"
                      placeholder="Enter 6-Digit Passcode"
                      value={webrtcInputCode}
                      onChange={e => setWebrtcInputCode(e.target.value)}
                      maxLength={6}
                      className="input-xs"
                    />
                    <button
                      onClick={handleStartWebRTCClient}
                      className="border-offset hover-border-accent"
                      style={{
                        background: 'var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer'
                      }}
                    >
                      Connect
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '4px', marginBottom: '4px' }}>
                <Terminal size={14} className="text-success" />
                <span style={{ fontSize: 'var(--text-xxs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-success)', textTransform: 'uppercase' }}>
                  Sync Console Log
                </span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '140px', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                {logs.length === 0 ? (
                  <div className="text-faint">Console is empty. Enable sync and trigger a connection.</div>
                ) : (
                  logs.map((log, idx) => <div key={idx}>{log}</div>)
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-12) 0', border: '1px dashed var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-2)' }}>
          <Wifi size={48} style={{ color: 'var(--color-text-faint)', marginBottom: 'var(--space-3)' }} />
          <h3 className="heading-sm-bold">
            Sync Engine is Disabled
          </h3>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '4px', maxWidth: '320px', textAlign: 'center' }}>
            Turn on the switch in the top right corner to activate discovery of your other machines on this network, and sync over the internet.
          </p>
        </div>
      )}

      <TurnRelaySettings />

      {peerToPair && (
        <ModalShell label="Enter pairing passcode" onClose={() => setPeerToPair(null)} width="320px">
          <h3 className="heading-sm-bold">
            Enter Pairing Passcode
          </h3>
          <p className="text-hint-flush">
            Please type the 6-digit passcode displayed on <strong>{peerToPair.name}</strong> to authorize connection.
          </p>
          <input
            type="text"
            maxLength={6}
            placeholder="Passcode (e.g. 123456)"
            value={passcodeVal}
            onChange={e => setPasscodeVal(e.target.value.replace(/\D/g, ''))}
            style={{
              width: '100%',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-base)',
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '0.1em'
            }}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && passcodeVal.length >= 5) {
                submitPeerPairing(passcodeVal)
              }
            }}
          />
          <div className="flex-gap-mt2">
            <button
              onClick={() => setPeerToPair(null)}
              style={{
                flex: 1,
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-surface-offset)',
                padding: '8px 0',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => submitPeerPairing(passcodeVal)}
              disabled={passcodeVal.length < 5}
              style={{
                flex: 1,
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                background: passcodeVal.length < 5 ? 'var(--color-surface-offset)' : 'var(--color-secondary)',
                color: passcodeVal.length < 5 ? 'var(--color-text-faint)' : 'var(--color-text-inverted)',
                border: 'none',
                padding: '8px 0',
                borderRadius: 'var(--radius-md)',
                cursor: passcodeVal.length < 5 ? 'not-allowed' : 'pointer'
              }}
            >
              Connect & Sync
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
