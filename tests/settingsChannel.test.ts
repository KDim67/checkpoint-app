import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// the handlers main registers, called the way the screen calls them
const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => unknown>())

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return {
    ...actual,
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn),
      on: () => {},
      removeHandler: () => {}
    }
  }
})

import { closeDb, getDb, getSetting, initDb, setSetting } from '../src/main/db'
import { registerDbHandlers } from '../src/main/ipc/db'
import { registerSyncHandlers } from '../src/main/ipc/sync'
import { registerWebhookHandlers } from '../src/main/ipc/webhook'
import { IpcChannels } from '../src/shared/ipcChannels'

const call = (channel: string, ...args: unknown[]): unknown => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`nothing handles ${channel}`)
  return fn({}, ...args)
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-settings-channel-'))
  initDb(dir)
  registerDbHandlers(getDb())
  registerSyncHandlers()
  registerWebhookHandlers()
})

afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('the plain settings channel', () => {
  it.each(['ai_api_key', 'ai_providers', 'mcp_auth_token', 'webhook_token', 'turn_credential', 'calendar_subscriptions', 'plugin_settings:a.js'])(
    'never hands the screen a secret: %s',
    async key => {
      setSetting(key, 'the secret')
      const read = await call(IpcChannels.DB_GET_SETTING, key)
      expect(read).toMatchObject({ success: false, error: expect.stringContaining('kept in the main process') })
      expect(JSON.stringify(read)).not.toContain('the secret')
    }
  )

  it('refuses to write or delete a secret, or the address an AI key is sent to', async () => {
    setSetting('ai_api_key', 'sk-live')
    setSetting('ai_base_url', 'https://api.openai.com/v1')
    expect(await call(IpcChannels.DB_SET_SETTING, 'ai_base_url', 'https://collector.example.com')).toMatchObject({ success: false })
    expect(await call(IpcChannels.DB_SET_SETTING, 'ai_api_key', 'swapped')).toMatchObject({ success: false })
    expect(await call(IpcChannels.DB_DELETE_SETTING, 'ai_api_key')).toMatchObject({ success: false })
    expect(getSetting('ai_base_url', '')).toBe('https://api.openai.com/v1')
    expect(getSetting('ai_api_key', '')).toBe('sk-live')
  })

  it('still reads and writes everything else', async () => {
    expect(await call(IpcChannels.DB_SET_SETTING, 'ai_model', 'gpt-4o')).toMatchObject({ success: true })
    expect(await call(IpcChannels.DB_GET_SETTING, 'ai_model')).toStrictEqual({ success: true, data: 'gpt-4o' })
  })
})

describe('the secrets the screen is meant to show', () => {
  it('the webhook token comes from its own call, as you paste it into what calls the gateway', async () => {
    expect(await call(IpcChannels.WEBHOOK_GET_TOKEN)).toBe('')
    setSetting('webhook_token', 'a'.repeat(48))
    expect(await call(IpcChannels.WEBHOOK_GET_TOKEN)).toBe('a'.repeat(48))
  })

  it('the TURN relay is saved trimmed and read back whole, since WebRTC needs it in the screen', async () => {
    await call(IpcChannels.SYNC_SET_TURN_RELAY, { url: ' turn:relay.example.com:3478 ', username: 'me ', credential: ' pw ' })
    expect(await call(IpcChannels.SYNC_GET_TURN_RELAY)).toStrictEqual({ url: 'turn:relay.example.com:3478', username: 'me', credential: 'pw' })
    expect(() => call(IpcChannels.SYNC_SET_TURN_RELAY, { url: 1 })).toThrow()
  })
})
