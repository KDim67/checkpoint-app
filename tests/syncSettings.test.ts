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

  it('does not mistake a user-named context for a port or a path', () => {
    // user-named contexts can make kanban_board_port, which must keep syncing
    expect(isMachineLocalSettingKey('kanban_board_port')).toBe(false)
    expect(isMachineLocalSettingKey('kanban_bg_path')).toBe(false)
    expect(isMachineLocalSettingKey('kanban_columns_position')).toBe(false)
    expect(isMachineLocalSettingKey('kanban_swimlanes_bounds')).toBe(false)
    expect(isMachineLocalSettingKey('backlog_columns_layout_port')).toBe(false)
    expect(isMachineLocalSettingKey('wall_port')).toBe(false)
    expect(isMachineLocalSettingKey('wall_path')).toBe(false)
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

  it('carries board configuration for a context with an awkward name', () => {
    expect(isSyncableSettingKey('kanban_board_port')).toBe(true)
    expect(isSyncableSettingKey('kanban_board_my-game')).toBe(true)
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

describe('secrets the app has actually created', () => {
  // real key names, the denylist matches substrings
  const SECRETS = [
    'webhook_token',      // write access over HTTP
    'mcp_auth_token',     // full read/write over every workspace
    'ai_api_key',
    'ai_provider_preset',
    'sync_pairing_code'
  ]

  it.each(SECRETS)('never sends %s to a paired machine', key => {
    expect(isSyncableSettingKey(key)).toBe(false)
  })

  it('drops them from a payload even when a peer sends them back', () => {
    // receive filters too, older peers still send these
    const rows = [
      { key: 'webhook_token', value: 'secret' },
      { key: 'mcp_auth_token', value: 'secret' },
      { key: 'kanban_board_work', value: '{}' }
    ]
    expect(filterSyncableSettings(rows).map(r => r.key)).toEqual(['kanban_board_work'])
  })

  it('still lets the workspace shape through, which is the point of syncing', () => {
    for (const key of ['kanban_board_work', 'backlog_columns_layout_work', 'wall_work']) {
      expect(isSyncableSettingKey(key)).toBe(true)
    }
  })
})

describe('a key nobody has thought about', () => {
  it('does not sync, which is the point of the allowlist', () => {
    // shapes the old substring denylist let through
    for (const key of ['github_pat', 'license_key', 'stripe_customer', 'device_fingerprint']) {
      expect(isSyncableSettingKey(key)).toBe(false)
    }
  })

  it('does not sync even when it sounds harmless', () => {
    expect(isSyncableSettingKey('some_future_preference')).toBe(false)
  })

  it('is the default for anything at all', () => {
    expect(isSyncableSettingKey('')).toBe(false)
    expect(isSyncableSettingKey('x')).toBe(false)
  })
})

describe('the settings that were syncing before the allowlist', () => {
  // pinned so the conversion didn't stop anything travelling
  it.each([
    'active_context', 'app_theme', 'appearance_compact', 'appearance_font_size',
    'backup_interval', 'backup_max_count', 'cheatsheet_pins', 'contexts_list',
    'customizer_active_plugins', 'customizer_enabled', 'customizer_shortcuts',
    'customizer_theme_vars', 'default_context', 'feature_backup', 'feature_hud',
    'feature_mcp', 'feature_tracker', 'feature_webhook', 'focus_auto_start_next',
    'focus_chime_enabled', 'focus_chime_volume', 'focus_long_break_interval',
    'focus_notifications_enabled', 'last_active_view', 'right_panel_width',
    'saved_views', 'start_view', 'unitySafeMode', 'widget_enabled', 'widget_opacity'
  ])('still carries %s', key => {
    expect(isSyncableSettingKey(key)).toBe(true)
  })

  it.each([
    'kanban_board_work', 'kanban_columns_work', 'backlog_columns_layout_work',
    'wall_work', 'wall_doc_abc123', 'wall_index_work',
    'wallview_rail_open', 'wallview_pen_smoothing',
    'feature_view_kanban', 'feature_view_wall'
  ])('still carries the family key %s', key => {
    expect(isSyncableSettingKey(key)).toBe(true)
  })
})

describe('clipboard recording is not something to switch on remotely', () => {
  it('never travels, even though every other view toggle does', () => {
    // it controls recording, not a tab; syncing it on records unasked
    expect(isSyncableSettingKey('feature_view_clipboard')).toBe(false)
    expect(isSyncableSettingKey('feature_view_analytics')).toBe(true)
  })
})
