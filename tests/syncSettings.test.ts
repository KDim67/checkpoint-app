import { describe, it, expect } from 'vitest'
import {
  filterSyncableSettings,
  isMachineLocalSettingKey,
  isSensitiveSettingKey,
  isSyncableSettingKey
} from '../src/shared/syncSettings'

describe('isSensitiveSettingKey', () => {
  it('holds back every AI and sync key', () => {
    expect(isSensitiveSettingKey('ai_api_key')).toBe(true)
    expect(isSensitiveSettingKey('ai_providers')).toBe(true)
    expect(isSensitiveSettingKey('sync_last_run')).toBe(true)
  })

  it('matches on substrings, not just prefixes', () => {
    expect(isSensitiveSettingKey('custom_openai_base')).toBe(true)
    expect(isSensitiveSettingKey('my_secret_thing')).toBe(true)
  })

  it('ignores case', () => {
    expect(isSensitiveSettingKey('AI_API_KEY')).toBe(true)
  })

  it('lets ordinary preferences through', () => {
    expect(isSensitiveSettingKey('app_theme')).toBe(false)
    expect(isSensitiveSettingKey('contexts_list')).toBe(false)
  })
})

describe('isMachineLocalSettingKey', () => {
  it('catches the keys that describe this machine', () => {
    for (const key of [
      'backup_path',
      'last_backup_time',
      'window_bounds',
      'widget_position',
      'webhook_port',
      'mcp_port',
      'startup_settings'
    ]) {
      expect(isMachineLocalSettingKey(key)).toBe(true)
    }
  })

  it('catches keys added later that follow the same shape', () => {
    expect(isMachineLocalSettingKey('export_path')).toBe(true)
    expect(isMachineLocalSettingKey('debug_port')).toBe(true)
    expect(isMachineLocalSettingKey('inspector_bounds')).toBe(true)
    expect(isMachineLocalSettingKey('overlay_position')).toBe(true)
  })

  it('leaves genuine preferences alone', () => {
    expect(isMachineLocalSettingKey('app_theme')).toBe(false)
    expect(isMachineLocalSettingKey('appearance_compact')).toBe(false)
    expect(isMachineLocalSettingKey('backup_interval')).toBe(false)
    expect(isMachineLocalSettingKey('saved_views')).toBe(false)
  })
})

describe('isSyncableSettingKey', () => {
  it('carries the settings that are the same person on any machine', () => {
    for (const key of [
      'app_theme',
      'appearance_compact',
      'appearance_font_size',
      'contexts_list',
      'default_context',
      'saved_views',
      'cheatsheet_pins',
      'customizer_theme_vars'
    ]) {
      expect(isSyncableSettingKey(key)).toBe(true)
    }
  })

  it('refuses both kinds of held-back key', () => {
    expect(isSyncableSettingKey('ai_api_key')).toBe(false)
    expect(isSyncableSettingKey('backup_path')).toBe(false)
  })
})

describe('filterSyncableSettings', () => {
  it('drops held-back rows and keeps the rest intact', () => {
    const rows = [
      { key: 'app_theme', value: '"midnight"' },
      { key: 'backup_path', value: '"D:/backups"' },
      { key: 'ai_api_key', value: '"sk-secret"' },
      { key: 'window_bounds', value: '{"x":0}' },
      { key: 'saved_views', value: '[]' }
    ]

    expect(filterSyncableSettings(rows)).toEqual([
      { key: 'app_theme', value: '"midnight"' },
      { key: 'saved_views', value: '[]' }
    ])
  })

  it('is a no-op on an empty payload', () => {
    expect(filterSyncableSettings([])).toEqual([])
  })
})
