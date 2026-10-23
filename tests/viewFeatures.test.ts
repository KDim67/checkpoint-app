import { describe, expect, it, vi } from 'vitest'

// every view can be switched off except the two you need to switch them back on and to get around

vi.mock('../src/renderer/src/lib/settings', () => ({
  // as if every view had been switched off in Settings
  getBoolSetting: vi.fn(async () => false),
  setBoolSetting: vi.fn(async () => {}),
  getStringSetting: vi.fn(async (_key: string, fallback: string) => fallback),
  setStringSetting: vi.fn(async () => {}),
  getEnumSetting: vi.fn(async (_key: string, fallback: string) => fallback)
}))

import { defaultViewEnabledMap, firstEnabledView, readViewFeatures } from '../src/renderer/src/lib/features'

describe('views with no switch of their own', () => {
  it('keeps Settings and the Workspaces page open whatever else is switched off', async () => {
    const enabled = await readViewFeatures()
    expect(enabled.settings).toBe(true)
    expect(enabled.workspaces).toBe(true)
    expect(enabled.kanban).toBe(false)
  })

  it('counts them as open before the settings are read, so nothing bounces off them at startup', () => {
    const enabled = defaultViewEnabledMap()
    expect(enabled.settings).toBe(true)
    expect(enabled.workspaces).toBe(true)
  })

  it('never lands on the Workspaces page as the first view when everything else is off', async () => {
    expect(firstEnabledView(await readViewFeatures())).toBe('settings')
  })
})
