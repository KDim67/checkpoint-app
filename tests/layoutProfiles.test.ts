// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLayoutProfile,
  readLayoutProfile,
  LAYOUT_PROFILE_KEY
} from '../src/renderer/src/lib/features'
import { getBoolSetting } from '../src/renderer/src/lib/settings'

const mockSettings = new Map<string, unknown>()

vi.mock('../src/renderer/src/data/settings', () => ({
  getSetting: vi.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, val: unknown) => {
    mockSettings.set(key, val)
  }),
  deleteSetting: vi.fn(async (key: string) => {
    mockSettings.delete(key)
  })
}))

describe('Layout Profiles (Revit-style Presets)', () => {
  beforeEach(() => {
    mockSettings.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads default layout profile as focused when unset', async () => {
    expect(LAYOUT_PROFILE_KEY).toBe('layout_profile')
    const profile = await readLayoutProfile()
    expect(profile).toBe('focused')
  })

  it('applies focused profile by disabling secondary tools and keeping core views', async () => {
    const onSettingsUpdate = vi.fn()
    window.addEventListener('settings-update-features', onSettingsUpdate)

    await applyLayoutProfile('focused')

    expect(await readLayoutProfile()).toBe('focused')
    expect(await getBoolSetting('feature_view_log', true)).toBe(false)
    expect(await getBoolSetting('feature_view_cheatsheets', true)).toBe(false)
    expect(await getBoolSetting('feature_view_analytics', true)).toBe(false)
    expect(await getBoolSetting('feature_view_clipboard', true)).toBe(false)
    expect(onSettingsUpdate).toHaveBeenCalled()

    window.removeEventListener('settings-update-features', onSettingsUpdate)
  })

  it('applies full profile by enabling all views for power users', async () => {
    const onSettingsUpdate = vi.fn()
    window.addEventListener('settings-update-features', onSettingsUpdate)

    await applyLayoutProfile('full')

    expect(await readLayoutProfile()).toBe('full')
    expect(await getBoolSetting('feature_view_log', false)).toBe(true)
    expect(await getBoolSetting('feature_view_cheatsheets', false)).toBe(true)
    expect(await getBoolSetting('feature_view_analytics', false)).toBe(true)
    expect(onSettingsUpdate).toHaveBeenCalled()

    window.removeEventListener('settings-update-features', onSettingsUpdate)
  })
})
