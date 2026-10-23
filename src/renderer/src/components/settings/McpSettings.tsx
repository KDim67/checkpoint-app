import React, { useEffect, useState } from 'react'
import { Copy, Check, RefreshCw, AlertTriangle, Plug, Link2, History } from 'lucide-react'
import SettingsSection, { FieldRow, SettingsInput, ToggleRow, Divider, SettingsCardSkeleton } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import McpActivityLog from './McpActivityLog'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import * as mcpApi from '../../data/mcp'

/** full read/write to every workspace: off by default, token masked, regenerate behind a confirm */
export default function McpSettings(): React.JSX.Element {
  const { toast } = useToast()
  const confirm = useConfirm()

  const [enabled, setEnabled] = useState(false)
  const [running, setRunning] = useState(false)
  const [port, setPort] = useState('9990')
  const [token, setToken] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<'token' | 'config' | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = async (): Promise<void> => {
    try {
      const status = await mcpApi.getStatus()
      setEnabled(status.enabled)
      setRunning(status.running)
      setPort(String(status.port))
      setToken(status.token)
    } catch (err) {
      console.error('Failed to read MCP status:', err)
    }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const handleToggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    // optimistic, then reconciled: a port clash mustn't leave it looking on
    setEnabled(next)
    try {
      await mcpApi.toggle(next, parseInt(port, 10) || 9990)
      toast(next ? 'MCP server on' : 'MCP server off')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`Could not ${next ? 'start' : 'stop'} the MCP server: ${message}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  /** on blur so a half-typed port never binds */
  const handlePortCommit = async (): Promise<void> => {
    const parsed = parseInt(port, 10)
    if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
      toast('Pick a port between 1024 and 65535')
      await refresh()
      return
    }
    if (!enabled) return
    setBusy(true)
    try {
      await mcpApi.toggle(true, parsed)
      toast(`MCP server now on port ${parsed}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`Could not use port ${parsed}: ${message}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const handleRegenerate = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Make a new token?',
      message: 'Any client set up with the current token stops working until you give it the new one.',
      confirmText: 'Make a new token',
      isDestructive: true
    })
    if (!confirmed) return
    try {
      setToken(await mcpApi.regenerateToken())
      setRevealed(false)
      toast('New token made. Give it to your MCP clients.')
    } catch (err) {
      console.error('Failed to regenerate token:', err)
      toast('Could not make a new token. Try again.')
    }
  }

  const clientConfig = JSON.stringify(
    {
      mcpServers: {
        checkpoint: {
          type: 'http',
          url: `http://127.0.0.1:${port}/`,
          headers: { Authorization: `Bearer ${token}` }
        }
      }
    },
    null,
    2
  )

  const copy = async (value: string, which: 'token' | 'config'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
    } catch {
      toast('Could not copy that. Try again.')
    }
  }

  if (loading) {
    return <SettingsCardSkeleton label="Loading the MCP server" rows={2} />
  }

  const mono: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-base)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-3)',
    wordBreak: 'break-all'
  }

  return (
    <>
      <SettingsSection icon={<Plug size={14} />} title="Server" description="Off until you turn it on, and reachable from this computer only.">
        <div className="col-xl">
          <ToggleRow
            label="MCP server"
            description="Serves your workspaces, notes and boards to MCP clients on this computer, such as Claude Desktop or an editor."
            checked={enabled}
            onChange={handleToggle}
            disabled={busy}
          >
            <div style={{ marginTop: 'var(--space-2)' }}>
              <span className="plugin-status" data-status={running ? 'running' : 'off'} role="status">
                {running ? `Running on 127.0.0.1:${port}` : 'Stopped'}
              </span>
            </div>
          </ToggleRow>

          {/* say plainly it grants full read and write */}
          <div className="settings-callout" data-tone="warning">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              Anything holding the token can <strong>read and change</strong> every workspace, note and board.
              The server only answers this computer, and never starts without the token.
            </span>
          </div>

          <Divider />

          <FieldRow label="Port" hint="Between 1024 and 65535. Saved when you leave the field.">
            <SettingsInput
              type="number"
              inputMode="numeric"
              value={port}
              onChange={setPort}
              onBlur={handlePortCommit}
              min={1024}
              max={65535}
            />
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Link2 size={14} />} title="Connect a Client" description="What an MCP client needs: the address and the token.">
        <div className="col-xl">
          <FieldRow label="Access token" group>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch', flexWrap: 'wrap' }}>
              <div style={{ ...mono, flex: '1 1 16rem', minWidth: 0 }} aria-label={revealed ? 'Access token' : 'Access token, hidden'}>
                {revealed ? token : '•'.repeat(48)}
              </div>
              <button type="button" className="btn-secondary" onClick={() => setRevealed(v => !v)} style={{ whiteSpace: 'nowrap' }}>
                {revealed ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => copy(token, 'token')}
                aria-label="Copy the access token"
                title="Copy the access token"
              >
                {copied === 'token' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleRegenerate}
                aria-label="Make a new access token"
                title="Make a new access token"
              >
                <RefreshCw size={14} aria-hidden="true" />
              </button>
            </div>
          </FieldRow>

          <FieldRow label="Client configuration" hint="Paste it into your MCP client's settings, then restart the client." group>
            <div className="col">
              <pre style={{ ...mono, margin: 0, maxHeight: '12rem', overflow: 'auto', whiteSpace: 'pre' }}>
                {revealed ? clientConfig : clientConfig.replace(token, '•'.repeat(48))}
              </pre>
              <button type="button" className="btn-secondary btn-with-icon" onClick={() => copy(clientConfig, 'config')} style={{ alignSelf: 'flex-start' }}>
                {copied === 'config' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied === 'config' ? 'Copied' : 'Copy the configuration'}
              </button>
            </div>
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection icon={<History size={14} />} title="Agent Activity" description="Every change an agent made through MCP. The ones that can be undone have an Undo.">
        <McpActivityLog />
      </SettingsSection>
    </>
  )
}
