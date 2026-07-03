/**
 * Typed const enum for ALL IPC channels used across the entire project.
 * Never use magic strings, always reference a member of this enum.
 * Defined upfront (Phase 1) so no future phase ever imports or invents new strings.
 */
export const enum IpcChannels {
  // Database
  DB_GET_ITEMS           = 'db:getItems',
  DB_CREATE_ITEM         = 'db:createItem',
  DB_UPDATE_ITEM         = 'db:updateItem',
  DB_DELETE_ITEM         = 'db:deleteItem',
  DB_GET_TAGS            = 'db:getTags',
  DB_CREATE_TAG          = 'db:createTag',
  DB_UPDATE_TAG          = 'db:updateTag',
  DB_DELETE_TAG          = 'db:deleteTag',
  DB_GET_SETTING         = 'db:getSetting',
  DB_SET_SETTING         = 'db:setSetting',
  DB_GET_RELATIONS       = 'db:getRelations',
  DB_CREATE_RELATION     = 'db:createRelation',
  DB_DELETE_RELATION     = 'db:deleteRelation',
  DB_SEARCH_ITEMS        = 'db:searchItems',
  DB_GET_CONTEXTS        = 'db:getContexts',
  DB_BULK_UPDATE_ITEMS   = 'db:bulkUpdateItems',
  DB_BULK_DELETE_ITEMS   = 'db:bulkDeleteItems',
  DB_REBALANCE_POSITIONS = 'db:rebalancePositions',
  DB_QUERY_TASKS         = 'db:queryTasks',
  DB_CREATE_FOCUS_SESSION = 'db:createFocusSession',
  DB_GET_FOCUS_SESSIONS   = 'db:getFocusSessions',

  // Markdown Notes
  NOTES_LIST             = 'notes:list',
  NOTES_READ             = 'notes:read',
  NOTES_WRITE            = 'notes:write',
  NOTES_DELETE           = 'notes:delete',
  NOTES_SEARCH           = 'notes:search',

  // Git Integration
  GIT_CHECK              = 'git:check',
  GIT_STATUS             = 'git:status',
  GIT_LOG                = 'git:log',

  // Clipboard History
  CLIPBOARD_GET_HISTORY  = 'clipboard:getHistory',
  CLIPBOARD_TOGGLE_PIN   = 'clipboard:togglePin',
  CLIPBOARD_UPDATE_LABEL = 'clipboard:updateLabel',
  CLIPBOARD_DELETE_ITEM  = 'clipboard:deleteItem',
  CLIPBOARD_CLEAR_HISTORY = 'clipboard:clearHistory',
  CLIPBOARD_CREATE_SNIPPET = 'clipboard:createSnippet',
  CLIPBOARD_RESTORE_ITEM = 'clipboard:restoreItem',
  CLIPBOARD_PASTE        = 'clipboard:paste',
  CLIPBOARD_HISTORY_CHANGED = 'clipboard:historyChanged',
  APP_NAVIGATE_TO_VIEW   = 'app:navigateToView',
  ANALYTICS_GET_DATA     = 'analytics:getData',

  // AI Streaming
  AI_STREAM_START        = 'ai:streamStart',
  AI_STREAM_ABORT        = 'ai:streamAbort',
  AI_TEST_CONNECTION     = 'ai:testConnection',
  AI_GENERATE_STRUCTURED = 'ai:generateStructured',
  AI_GENERATE_ABORT      = 'ai:generateAbort',
  AI_CHUNK               = 'ai:chunk',
  AI_DONE                = 'ai:done',
  AI_ERROR               = 'ai:error',

  // Widget
  WIDGET_TOGGLE          = 'widget:toggle',
  WIDGET_SET_POSITION    = 'widget:setPosition',
  WIDGET_SET_OPACITY     = 'widget:setOpacity',

  // Theme hot-reload
  THEME_UPDATE           = 'theme:update',

  // Hardware profiling (AI Cookbook)
  HARDWARE_GET_SPECS     = 'hardware:getSpecs',

  // Ollama (AI Cookbook)
  OLLAMA_CHECK_INSTALLED = 'ollama:checkInstalled',
  OLLAMA_LIST_LOCAL      = 'ollama:listLocal',
  OLLAMA_PULL            = 'ollama:pull',
  OLLAMA_PULL_PROGRESS   = 'ollama:pullProgress',
  OLLAMA_PULL_DONE       = 'ollama:pullDone',
  OLLAMA_PULL_ERROR      = 'ollama:pullError',
  OLLAMA_STOP            = 'ollama:stop',
  OLLAMA_DELETE          = 'ollama:delete',

  // HUD
  HUD_TOGGLE             = 'hud:toggle',
  HUD_ON_TOGGLE          = 'hud:onToggle',
  HUD_SUBMIT             = 'hud:submit',

  // Webhook
  WEBHOOK_TOGGLE         = 'webhook:toggle',
  WEBHOOK_EVENT          = 'webhook:event',

  // Backup
  BACKUP_RUN             = 'backup:run',
  BACKUP_STATUS          = 'backup:status',

  // Activity Tracker
  TRACKER_TOGGLE         = 'tracker:toggle',
  TRACKER_GET_STATE      = 'tracker:getState',
  TRACKER_ACTIVITY_LOG   = 'tracker:activityLog',
  TRACKER_GET_STATS      = 'tracker:getStats',

  // App
  APP_GET_VERSION        = 'app:getVersion',
  APP_OPEN_EXTERNAL      = 'app:openExternal',
  APP_GET_DATA_PATH      = 'app:getDataPath',
  APP_MINIMIZE           = 'app:minimize',
  APP_MAXIMIZE           = 'app:maximize',
  APP_CLOSE              = 'app:close',
  APP_SAVE_FILE          = 'app:saveFile',

  // Phase 22 Customizer & Extensions
  CUSTOMIZER_GET_PLUGINS        = 'customizer:getPlugins',
  CUSTOMIZER_TOGGLE_PLUGIN       = 'customizer:togglePlugin',
  CUSTOMIZER_OPEN_PLUGINS_FOLDER = 'customizer:openPluginsFolder',
  CUSTOMIZER_UPDATE_THEME        = 'customizer:updateTheme',
  CUSTOMIZER_REGISTER_SHORTCUTS  = 'customizer:registerShortcuts',

  // Cheatsheets
  CHEATSHEETS_LIST              = 'cheatsheets:list',
  CHEATSHEETS_ADD               = 'cheatsheets:add',
  CHEATSHEETS_REMOVE            = 'cheatsheets:remove',
  CHEATSHEETS_RENAME            = 'cheatsheets:rename',
  CHEATSHEETS_SELECT            = 'cheatsheets:select',
  CHEATSHEETS_GET_TEXT          = 'cheatsheets:getText',
  CHEATSHEETS_GET_RELEVANT      = 'cheatsheets:getRelevant',
  CHEATSHEETS_SEARCH            = 'cheatsheets:search',

  // Game Dev Helpers
  GAMEDEV_BATCH_RENAME          = 'gamedev:batchRename',
  GAMEDEV_SELECT_TEXTURE        = 'gamedev:selectTexture',
  GAMEDEV_LOAD_TEXTURE          = 'gamedev:loadTexture',
  GAMEDEV_SAVE_MAPS             = 'gamedev:saveMaps',
  GAMEDEV_SAVE_SEAMLESS         = 'gamedev:saveSeamless',
  GAMEDEV_SELECT_SPRITE_FOLDER  = 'gamedev:selectSpriteFolder',
  GAMEDEV_SAVE_SPRITE_ATLAS     = 'gamedev:saveSpriteAtlas',
  GAMEDEV_SAVE_SLICES           = 'gamedev:saveSlices',
  GAMEDEV_SAVE_LUT              = 'gamedev:saveLut',
  GAMEDEV_SAVE_UPSCALED         = 'gamedev:saveUpscaled',

  // AI Memory Engine & Workspace Indexing
  AI_GET_MEMORIES               = 'ai:getMemories',
  AI_SAVE_MEMORY                = 'ai:saveMemory',
  AI_DELETE_MEMORY              = 'ai:deleteMemory',
  AI_SEARCH_MEMORIES            = 'ai:searchMemories',
  AI_TOGGLE_PIN_MEMORY          = 'ai:togglePinMemory',
  AI_UPDATE_MEMORY_CONTENT      = 'ai:updateMemoryContent',
  AI_BATCH_SAVE_MEMORIES        = 'ai:batchSaveMemories',
  AI_CONSOLIDATE_MEMORY         = 'ai:consolidateMemory',
  WORKSPACE_SELECT_FOLDER       = 'workspace:selectFolder',
  WORKSPACE_GET_STRUCTURE        = 'workspace:getStructure',
  WORKSPACE_READ_FILE           = 'workspace:readFile'
}
