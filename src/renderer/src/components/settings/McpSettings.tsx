import React, { useEffect, useState } from 'react'
import { Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import { FieldRow, SettingsInput, ToggleSwitch, RowBetween, Divider } from './SettingsSection'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import McpActivityLog from './McpActivityLog'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import * as mcpApi from '../../data/mcp'

/**
 * Controls the Model Context Protocol server.
 *
 * The server hands an external agent read and write access to every workspace,
 * so this panel is deliberately explicit about that: it is off by default, the
 * token is masked, and regenerating it is behind a confirmation because it
 * silently breaks every client already configured against it.
 */
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
    // Optimistic, then reconciled from the main process: a port clash must not
    // leave the switch showing "on" while nothing is listening.
    setEnabled(next)
    try {
      await mcpApi.toggle(next, parseInt(port, 10) || 9990)
      toast(next ? 'MCP server started.' : 'MCP server stopped.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`Could not start the MCP server, ${message}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  /** Applied on blur so a half-typed port never gets bound. */
  const handlePortCommit = async (): Promise<void> => {
    const parsed = parseInt(port, 10)
    if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
      toast('Port must be between 1024 and 65535.')
      await refresh()
      return
    }
    if (!enabled) return
    setBusy(true)
    try {
      await mcpApi.toggle(true, parsed)
      toast(`MCP server moved to port ${parsed}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`Could not bind port ${parsed}, ${message}`)
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  const handleRegenerate = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Regenerate access token?',
      message: 'Any client already configured with the current token will stop working until you update it.',
      confirmText: 'Regenerate',
      isDestructive: true
    })
    if (!confirmed) return
    try {
      setToken(await mcpApi.regenerateToken())
      setRevealed(false)
      toast('New token generated. Update your MCP clients.')
    } catch (err) {
      console.error('Failed to regenerate token:', err)
      toast('Could not regenerate the token.')
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
      toast('Could not copy to the clipboard.')
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>Loading…</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <RowBetween>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Enable MCP Server
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            Serves your workspaces, notes and boards to MCP clients on this machine only.
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={handleToggle} disabled={busy} label="Enable MCP Server" />
      </RowBetween>

      {/* Stated plainly rather than buried: this grants full read and write. */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-start',
          background: 'var(--color-warning-muted)',
          border: '1px solid var(--color-warning)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.5
        }}
      >
        <AlertTriangle size={14} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: '1px' }} />
        <span>
          Anything holding the token below can <strong>read and modify</strong> every workspace, note and board.
          The server only accepts connections from this computer, and never starts without the token.
        </span>
      </div>

      <Divider />

      <FieldRow label="Port" hint="Applied when the field loses focus. 1024–65535.">
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

      <RowBetween>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Status:{' '}
          <strong style={{ color: running ? 'var(--color-success)' : 'var(--color-text-faint)' }}>
            {running ? `Listening on 127.0.0.1:${port}` : 'Stopped'}
          </strong>
        </div>
      </RowBetween>

      <Divider />

      <FieldRow label="Access Token">
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' }}>
          <div style={{ ...mono, flex: 1, minWidth: 0 }}>
            {revealed ? token : '•'.repeat(48)}
          </div>
          <button className="btn-secondary" onClick={() => setRevealed(v => !v)} style={{ whiteSpace: 'nowrap' }}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => copy(token, 'token')}
            aria-label="Copy access token"
            title="Copy access token"
          >
            {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            className="btn-secondary"
            onClick={handleRegenerate}
            aria-label="Regenerate access token"
            title="Regenerate access token"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </FieldRow>

      <Divider />

      <FieldRow
        label="Recent Agent Activity"
        hint="Every change an external agent made through MCP. Reversible ones can be undone here."
      >
        <McpActivityLog />
      </FieldRow>

      <Divider />

      <FieldRow label="Client Configuration" hint="Paste into your MCP client's config, then restart it.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <pre style={{ ...mono, margin: 0, maxHeight: '190px', overflow: 'auto', whiteSpace: 'pre' }}>
            {revealed ? clientConfig : clientConfig.replace(token, '•'.repeat(48))}
          </pre>
          <button className="btn-secondary" onClick={() => copy(clientConfig, 'config')} style={{ alignSelf: 'flex-start' }}>
            {copied === 'config' ? 'Copied' : 'Copy Configuration'}
          </button>
        </div>
      </FieldRow>
    </div>
  )
}
