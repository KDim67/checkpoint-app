/** a connection's key, encrypted on this computer; only main ever reads it */

import { deleteSetting, getSetting, setSetting } from '../db'
import type { ConnectionService } from '../../shared/connections'

const keyName = (service: ConnectionService): string => `connection_key:${service}`

export function getConnectionKey(service: ConnectionService): string | null {
  const value = getSetting<unknown>(keyName(service), null)
  return typeof value === 'string' && value ? value : null
}

export function setConnectionKey(service: ConnectionService, key: string): void {
  setSetting(keyName(service), key)
}

export function removeConnectionKey(service: ConnectionService): void {
  deleteSetting(keyName(service))
}
