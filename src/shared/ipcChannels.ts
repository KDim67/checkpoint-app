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

  // AI Streaming
  AI_STREAM_START        = 'ai:streamStart',
  AI_STREAM_ABORT        = 'ai:streamAbort',
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

  // App
  APP_GET_VERSION        = 'app:getVersion',
  APP_OPEN_EXTERNAL      = 'app:openExternal',
  APP_GET_DATA_PATH      = 'app:getDataPath',
  APP_MINIMIZE           = 'app:minimize',
  APP_MAXIMIZE           = 'app:maximize',
  APP_CLOSE              = 'app:close',
  APP_SAVE_FILE          = 'app:saveFile'
}
