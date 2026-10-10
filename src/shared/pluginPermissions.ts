/** what a plugin may ask for, what you granted, and the words both are shown in */

export const PLUGIN_PERMISSIONS = ['read', 'write', 'notify', 'network'] as const

/** local: turning a plugin on here must never turn it on on another machine */
export const PLUGIN_GRANTS_KEY = 'plugin_grants'
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number]

/** label names it in errors and settings, consent is the sentence the dialog shows */
export const PERMISSION_TEXT: Record<PluginPermission, { label: string; consent: string }> = {
  read: {
    label: 'See cards',
    consent: 'See cards, tasks and log entries in the workspaces below, and hear when they are created, finished or due.'
  },
  write: {
    label: 'Change cards',
    consent: 'Create and change cards, tasks and log entries in those workspaces. It can never delete anything.'
  },
  notify: {
    label: 'Show notifications',
    consent: 'Show you notifications. Quiet hours still apply.'
  },
  network: {
    label: 'Reach the internet',
    consent: 'Send requests to these sites, and only these:'
  }
}

/** what a file says it needs, read as text; the hosts list is the network ask */
export interface PluginRequest {
  permissions: PluginPermission[]
  hosts: string[]
  /** shown so a typo doesn't silently cost a plugin what it meant to ask for */
  ignored: string[]
}

export interface PluginGrant {
  /** off keeps the grant, so turning it back on can start from what you picked */
  on: boolean
  permissions: PluginPermission[]
  hosts: string[]
  workspaces: string[]
  grantedAt: number
  /** switched on before plugins ran sandboxed; never runs until approved again */
  legacy?: boolean
  /** sha-256 of the file you approved, so a change that asks for nothing more still shows */
  sourceHash?: string
}

export type PluginStatus = 'off' | 'starting' | 'running' | 'needs-approval' | 'stopped' | 'crashed'

const isPermission = (value: string): value is PluginPermission =>
  (PLUGIN_PERMISSIONS as readonly string[]).includes(value)

// a name with at least one dot and a letter TLD: no IPs, no localhost, no ports, no wildcards
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** lowercased, trailing dot dropped; null for anything that isn't a plain public name */
export function normalizeHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  return HOSTNAME.test(host) ? host : null
}

export function normalizeRequest(permissions: string[], hosts: string[]): PluginRequest {
  const ignored: string[] = []
  const granted = new Set<PluginPermission>()
  for (const raw of permissions) {
    const name = raw.trim().toLowerCase()
    if (isPermission(name)) granted.add(name)
    else ignored.push(raw)
  }
  const named = new Set<string>()
  for (const raw of hosts) {
    const host = normalizeHost(raw)
    if (host) named.add(host)
    else ignored.push(raw)
  }
  // listing hosts is asking for the network; "network" with none reaches nothing
  if (named.size > 0) granted.add('network')
  else granted.delete('network')
  return {
    permissions: PLUGIN_PERMISSIONS.filter(p => granted.has(p)),
    hosts: [...named].sort(),
    ignored
  }
}

/** asking for less than you approved is fine, asking for anything more needs you again */
export function grantCovers(grant: PluginGrant, request: PluginRequest): boolean {
  if (grant.legacy) return false
  return request.permissions.every(p => grant.permissions.includes(p))
    && request.hosts.every(h => grant.hosts.includes(h))
}

export function sameRequest(a: Pick<PluginRequest, 'permissions' | 'hosts'>, b: Pick<PluginRequest, 'permissions' | 'hosts'>): boolean {
  const key = (r: Pick<PluginRequest, 'permissions' | 'hosts'>): string =>
    JSON.stringify([[...r.permissions].sort(), [...r.hosts].sort()])
  return key(a) === key(b)
}

/** the stored value is hand-editable JSON; anything malformed reads as no grant */
export function readGrants(raw: unknown): Record<string, PluginGrant> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, PluginGrant> = {}
  for (const [filename, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const g = value as Record<string, unknown>
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
    out[filename] = {
      on: g.on === true,
      permissions: strings(g.permissions).filter(isPermission),
      hosts: strings(g.hosts).map(normalizeHost).filter((h): h is string => h !== null),
      workspaces: [...new Set(strings(g.workspaces))],
      grantedAt: typeof g.grantedAt === 'number' ? g.grantedAt : 0,
      ...(g.legacy === true ? { legacy: true } : {}),
      ...(typeof g.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(g.sourceHash) ? { sourceHash: g.sourceHash } : {})
    }
  }
  return out
}

/** a renamed workspace keeps the plugins you let into it */
export function renameGrantWorkspaces(grants: Record<string, PluginGrant>, from: string, to: string): Record<string, PluginGrant> {
  const out: Record<string, PluginGrant> = {}
  for (const [filename, grant] of Object.entries(grants)) {
    out[filename] = grant.workspaces.includes(from)
      ? { ...grant, workspaces: [...new Set(grant.workspaces.map(w => (w === from ? to : w)))] }
      : grant
  }
  return out
}
