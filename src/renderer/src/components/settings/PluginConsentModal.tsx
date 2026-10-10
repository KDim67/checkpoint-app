import React, { useState } from 'react'
import { Bell, Eye, Globe, HardDrive, PencilLine, ShieldCheck, TriangleAlert } from 'lucide-react'
import ModalShell from '../ui/ModalShell'
import { PERMISSION_TEXT, type PluginPermission } from '../../../../shared/pluginPermissions'
import type { PluginInfo } from '../../../../shared/types'
import type { WorkspaceEntry } from '../../lib/createWorkspace'

interface Props {
  plugin: PluginInfo
  workspaces: WorkspaceEntry[]
  activeWorkspace: string
  onClose: () => void
  /** resolves false to keep the dialog open, the reason is shown beside the plugin */
  onApprove: (workspaces: string[]) => Promise<boolean>
}

const ICONS: Record<PluginPermission, React.ReactNode> = {
  read: <Eye size={14} />,
  write: <PencilLine size={14} />,
  notify: <Bell size={14} />,
  network: <Globe size={14} />
}

/** what a plugin asks for, in plain words, and which workspaces it gets; the same list main will enforce */
export default function PluginConsentModal({ plugin, workspaces, activeWorkspace, onClose, onApprove }: Props): React.JSX.Element {
  const { permissions, hosts, ignored } = plugin.request
  const usesWorkspaces = permissions.includes('read') || permissions.includes('write')
  const known = new Set(workspaces.map(w => w.slug))
  const previous = (plugin.grant?.workspaces ?? []).filter(w => known.has(w))
  const [picked, setPicked] = useState<string[]>(
    previous.length > 0 ? previous : known.has(activeWorkspace) ? [activeWorkspace] : []
  )
  const [busy, setBusy] = useState(false)

  const toggle = (slug: string): void =>
    setPicked(list => (list.includes(slug) ? list.filter(s => s !== slug) : [...list, slug]))

  const approve = async (): Promise<void> => {
    setBusy(true)
    try {
      if (await onApprove(usesWorkspaces ? picked : [])) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell label={`Turn on ${plugin.name}`} onClose={onClose} width="460px" closeOnBackdrop={false}>
      <div className="plugin-consent-head">
        <ShieldCheck size={20} className="plugin-consent-shield" />
        <div>
          <div className="plugin-consent-title">Turn on {plugin.name}?</div>
          <div className="text-sub">
            It runs in a sandbox and can only do what is listed here, on this computer. You can change this later.
          </div>
        </div>
      </div>

      {plugin.changed && (
        <div className="text-sub">Its code changed since you approved it, though it asks for nothing more. Turning it on accepts the new code.</div>
      )}

      <ul className="plugin-consent-list">
        {permissions.map(permission => (
          <li key={permission} className="plugin-consent-item">
            <span className="plugin-consent-icon">{ICONS[permission]}</span>
            <div className="fill">
              <div>{PERMISSION_TEXT[permission].consent}</div>
              {permission === 'network' && (
                <div className="plugin-host-list">
                  {hosts.map(host => <code key={host} className="plugin-host-chip">{host}</code>)}
                </div>
              )}
            </div>
          </li>
        ))}
        <li className="plugin-consent-item plugin-consent-item-quiet">
          <span className="plugin-consent-icon"><HardDrive size={14} /></span>
          <div className="fill">
            {permissions.length === 0
              ? 'It asks for nothing beyond a little private storage of its own.'
              : 'Keep a little private storage of its own.'}
          </div>
        </li>
      </ul>

      {usesWorkspaces && (
        <fieldset className="plugin-consent-workspaces">
          <legend className="text-item">Workspaces it can use</legend>
          {workspaces.map(w => (
            <label key={w.slug} className="plugin-consent-workspace">
              <input type="checkbox" checked={picked.includes(w.slug)} onChange={() => toggle(w.slug)} />
              <span>{w.name}</span>
            </label>
          ))}
          {picked.length === 0 && <div className="text-sub">Pick at least one, or it has nothing to work with.</div>}
        </fieldset>
      )}

      {permissions.includes('read') && permissions.includes('network') && (
        <div className="plugin-consent-warning">
          <TriangleAlert size={14} />
          <span>Together these let it send what it reads to the sites above. Only turn it on if you trust it.</span>
        </div>
      )}

      {ignored.length > 0 && (
        <div className="text-sub">
          It also lists {ignored.map(i => `"${i}"`).join(', ')}, which Checkpoint doesn't offer, so that is ignored.
        </div>
      )}

      <div className="plugin-consent-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || (usesWorkspaces && picked.length === 0)}
          onClick={() => void approve()}
        >
          {busy ? 'Starting…' : 'Turn on'}
        </button>
      </div>
    </ModalShell>
  )
}
