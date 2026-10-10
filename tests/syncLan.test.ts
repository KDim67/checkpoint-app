import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../src/main/db'
import { SyncService } from '../src/main/syncService'

// the real host and client over a local socket; one database, so the sync is with itself and only the wire is tested

let dir: string
const host = new SyncService()
const client = new SyncService()

const freePort = (): Promise<number> => new Promise(resolve => {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as net.AddressInfo
    probe.close(() => resolve(port))
  })
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-lan-'))
  initDb(dir)
})

afterEach(() => {
  host.stopHost()
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('syncing over the local network', () => {
  it('pairs with the code the host shows and syncs over the encrypted channel to the end', async () => {
    const port = await freePort()
    host.startHost(port)
    const result = await client.connectAndSync('127.0.0.1', port, host.getStatus().pairingCode, dir)
    expect(result).toStrictEqual({ dbUpdates: 0, filesSynced: 0 })
    expect(client.getStatus().progress).toBe('Sync completed successfully!')
  })

  it('refuses a wrong code, and both sides say so', async () => {
    const port = await freePort()
    host.startHost(port)
    const wrong = host.getStatus().pairingCode === '000000' ? '111111' : '000000'
    await expect(client.connectAndSync('127.0.0.1', port, wrong, dir)).rejects.toThrow('The pairing code did not match.')
    expect(client.getStatus().progress).toBe('Authentication failed. Please verify pairing code.')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(host.getStatus().progress).toBe('Authentication failed: invalid code.')
  })
})
