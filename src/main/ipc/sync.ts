/** LAN sync between machines, and applying what arrives */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { SyncService } from '../syncService'
import { z } from 'zod'
import { getSetting, setSetting } from '../db'
import { TURN_SETTING_KEYS, type TurnSettings } from '../../shared/iceConfig'

const syncService = new SyncService()

/** for the shutdown sweep */
export function stopSyncHost(): void {
  syncService.stopHost()
}
import { app } from 'electron'
import type { SyncPayload } from '../../shared/types'
import path from 'path'
import fs from 'fs'

const TurnInput = z.object({ url: z.string().max(2000), username: z.string().max(500), credential: z.string().max(2000) })

const textSetting = (key: string): string => {
  const value = getSetting<unknown>(key, '')
  return typeof value === 'string' ? value : ''
}

export function registerSyncHandlers(): void {
  // the one secret the screen holds: webrtc runs there and needs the relay password to connect
  ipcMain.handle(IpcChannels.SYNC_GET_TURN_RELAY, (): Required<TurnSettings> => ({
    url: textSetting(TURN_SETTING_KEYS.url),
    username: textSetting(TURN_SETTING_KEYS.username),
    credential: textSetting(TURN_SETTING_KEYS.credential)
  }))

  ipcMain.handle(IpcChannels.SYNC_SET_TURN_RELAY, (_event, relay: unknown) => {
    const { url, username, credential } = TurnInput.parse(relay)
    setSetting(TURN_SETTING_KEYS.url, url.trim())
    setSetting(TURN_SETTING_KEYS.username, username.trim())
    setSetting(TURN_SETTING_KEYS.credential, credential.trim())
  })

  ipcMain.handle(IpcChannels.SYNC_START_HOST, (_event, port?: number) => {
    syncService.startHost(port)
  })

  ipcMain.handle(IpcChannels.SYNC_STOP_HOST, () => {
    syncService.stopHost()
  })

  ipcMain.handle(IpcChannels.SYNC_CONNECT_AND_SYNC, async (_event, hostIp: string, port: number, pairingCode: string) => {
    const dataPath = app.getPath('userData')
    return syncService.connectAndSync(hostIp, port, pairingCode, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_STATUS, () => {
    return syncService.getStatus()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DISCOVERED_PEERS, () => {
    return syncService.getDiscoveredPeers()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DB_PAYLOAD, () => {
    return syncService.getDatabasePayload()
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_DB_PAYLOAD, (_event, payload: SyncPayload) => {
    return syncService.applyDatabasePayload(payload)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_FILE_INDEX, (_event, subDir: 'notes' | 'media') => {
    const dataPath = app.getPath('userData')
    return syncService.getFileIndex(subDir, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_READ_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  })

  ipcMain.handle(IpcChannels.SYNC_WRITE_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string, buffer: ArrayBuffer, mtime?: number) => {
    const dataPath = app.getPath('userData')
    const destDir = path.join(dataPath, subDir)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const destPath = path.join(destDir, relPath)
    fs.writeFileSync(destPath, Buffer.from(buffer))
    if (mtime) {
      const timeSecs = mtime / 1000
      fs.utimesSync(destPath, timeSecs, timeSecs)
    }
  })

  ipcMain.handle(IpcChannels.SYNC_DELETE_FILE, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  })

  // validated again here, the rows reach SQL through this handler whoever the caller is
  ipcMain.handle(IpcChannels.SYNC_APPLY_BOARD_BASELINE, async (
    _event,
    context: unknown,
    items: unknown,
    tags: unknown,
    itemTags: unknown,
    relations: unknown
  ) => {
    const { applyBoardBaselineTx } = await import('../db')
    const { normalizeCollabMessage } = await import('../../shared/collabProtocol')
    const baseline = normalizeCollabMessage({ type: 'board-baseline', context, items, tags, itemTags, relations })
    if (!baseline || baseline.type !== 'board-baseline') return
    return applyBoardBaselineTx(
      baseline.context,
      baseline.items,
      baseline.tags,
      baseline.itemTags,
      baseline.relations
    )
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_REMOTE_MUTATION, async (_event, mutation: unknown) => {
    const { applyRemoteMutationTx } = await import('../db')
    const { normalizeRemoteMutation } = await import('../../shared/collabProtocol')
    const safe = normalizeRemoteMutation(mutation)
    if (!safe) {
      console.warn('[sync] Dropped a remote mutation this build cannot apply.')
      return
    }
    return applyRemoteMutationTx(safe)
  })
}
