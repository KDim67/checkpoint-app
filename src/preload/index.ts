import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IpcChannels } from '../shared/ipcChannels'
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  AiStreamParams,
  BulkUpdatePayload,
  SearchQuery,
  TaskQueryParams,
  HardwareSpecs,
  OllamaStatus,
  PullProgressEvent,
  FocusSession,
  CreateFocusSessionPayload,
  NoteMetadata,
  GitCommit,
  GitStatusResult,
  ClipboardItem,
  AnalyticsData,
  PluginInfo,
  ShortcutMap
} from '../shared/types'

/**
 * Secure IPC bridge, exposes a typed API surface to the renderer.
 *
 * CRITICAL PATTERN: Every ipcRenderer.on() subscription MUST return an
 * explicit cleanup/unsubscribe function. React components call this in their
 * useEffect return to prevent zombie listeners and memory leaks after unmount.
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  app: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    },
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
    getDataPath: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.APP_GET_DATA_PATH),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.APP_OPEN_EXTERNAL, url),
    minimize: (): void => ipcRenderer.send(IpcChannels.APP_MINIMIZE),
    maximize: (): void => ipcRenderer.send(IpcChannels.APP_MAXIMIZE),
    close: (): void => ipcRenderer.send(IpcChannels.APP_CLOSE),
    saveFile: (defaultName: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.APP_SAVE_FILE, defaultName, content),
    onNavigateToView: (callback: (view: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, view: string) => callback(view)
      ipcRenderer.on(IpcChannels.APP_NAVIGATE_TO_VIEW, handler)
      return () => ipcRenderer.removeListener(IpcChannels.APP_NAVIGATE_TO_VIEW, handler)
    }
  },

  // Database
  db: {
    getItems: async (
      context: string,
      type: string,
      page: number,
      pageSize: number
    ): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_ITEMS, context, type, page, pageSize)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createItem: async (
      payload: CreateItemPayload,
      tagIds: string[] = []
    ): Promise<Item> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_ITEM, payload, tagIds)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    updateItem: async (
      id: string,
      patch: Partial<Item>,
      tagIds?: string[]
    ): Promise<Item> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_ITEM, id, patch, tagIds)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    deleteItem: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_ITEM, id)
      if (!res.success) throw new Error(res.error)
    },

    getTags: async (): Promise<Tag[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_TAGS)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createTag: async (payload: CreateTagPayload): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_TAG, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    updateTag: async (id: string, payload: Partial<CreateTagPayload>): Promise<Tag> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_UPDATE_TAG, id, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    deleteTag: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_TAG, id)
      if (!res.success) throw new Error(res.error)
    },

    getSetting: async (key: string): Promise<unknown> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_SETTING, key)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    setSetting: async (key: string, value: unknown): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_SET_SETTING, key, value)
      if (!res.success) throw new Error(res.error)
    },

    getRelations: async (itemId: string): Promise<Relation[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_RELATIONS, itemId)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createRelation: async (fromId: string, toId: string, type: RelationType): Promise<Relation> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_RELATION, fromId, toId, type)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    deleteRelation: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_DELETE_RELATION, id)
      if (!res.success) throw new Error(res.error)
    },

    searchItems: async (query: SearchQuery): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_SEARCH_ITEMS, query)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    getContexts: async (): Promise<string[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_CONTEXTS)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    bulkUpdateItems: async (payload: BulkUpdatePayload): Promise<{ updated: number }> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_BULK_UPDATE_ITEMS, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    bulkDeleteItems: async (ids: string[]): Promise<{ deleted: number }> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_BULK_DELETE_ITEMS, ids)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    rebalancePositions: async (context: string, status: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_REBALANCE_POSITIONS, context, status)
      if (!res.success) throw new Error(res.error)
    },

    queryTasks: async (context: string, params: TaskQueryParams): Promise<PaginatedResult<Item>> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_QUERY_TASKS, context, params)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    createFocusSession: async (payload: CreateFocusSessionPayload): Promise<FocusSession> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_CREATE_FOCUS_SESSION, payload)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    getFocusSessions: async (context: string): Promise<FocusSession[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.DB_GET_FOCUS_SESSIONS, context)
      if (!res.success) throw new Error(res.error)
      return res.data
    }
  },

  // AI Streaming
  ai: {
    startStream: (params: AiStreamParams): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_START, params),

    abortStream: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_STREAM_ABORT),

    // Returns an unsubscribe function, MUST be called on component unmount
    onChunk: (callback: (chunk: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, chunk: string) => callback(chunk)
      ipcRenderer.on(IpcChannels.AI_CHUNK, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_CHUNK, handler)
    },

    onDone: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on(IpcChannels.AI_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_DONE, handler)
    },

    onError: (callback: (errMessage: string) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, errMessage: string) => callback(errMessage)
      ipcRenderer.on(IpcChannels.AI_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.AI_ERROR, handler)
    }
  },

  // Widget
  widget: {
    toggle: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_TOGGLE),
    setPosition: (pos: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_SET_POSITION, pos),
    setOpacity: (opacity: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WIDGET_SET_OPACITY, opacity)
  },

  // Theme hot-reload
  onThemeUpdate: (callback: (css: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, css: string) => callback(css)
    ipcRenderer.on(IpcChannels.THEME_UPDATE, handler)
    return () => ipcRenderer.removeListener(IpcChannels.THEME_UPDATE, handler)
  },

  // HUD
  hud: {
    toggle: (active?: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.HUD_TOGGLE, active),

    onToggle: (callback: (visible: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, visible: boolean) => callback(visible)
      ipcRenderer.on(IpcChannels.HUD_ON_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.HUD_ON_TOGGLE, handler)
    },

    onReset: (callback: () => void): (() => void) => {
      const handler = () => callback()
      ipcRenderer.on('hud:reset', handler)
      return () => ipcRenderer.removeListener('hud:reset', handler)
    },

    resize: (height: number): void => {
      ipcRenderer.send('hud:resize', height)
    }
  },

  // Webhook
  webhook: {
    toggle: (active: boolean, port: number): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.WEBHOOK_TOGGLE, active, port),

    onEvent: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(IpcChannels.WEBHOOK_EVENT, handler)
      return () => ipcRenderer.removeListener(IpcChannels.WEBHOOK_EVENT, handler)
    }
  },

  // Backup
  backup: {
    run: (action?: 'backup' | 'restore' | 'delete' | 'init', filename?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.BACKUP_RUN, action, filename),
    getStatus: (): Promise<{
      enabled: boolean
      interval: string
      path: string
      maxCount: number
      backups: { filename: string; timestamp: number; size: number }[]
    }> => ipcRenderer.invoke(IpcChannels.BACKUP_STATUS)
  },

  // Activity Tracker
  tracker: {
    toggle: (active: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_TOGGLE, active),
    getState: (): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.TRACKER_GET_STATE),
    getActivityStats: (context: string | null, start: number, end: number): Promise<{
      totalDurationMs: number
      byProcess: Array<{ processName: string; durationMs: number }>
      byContext: Array<{ context: string; durationMs: number }>
      byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
    }> => ipcRenderer.invoke(IpcChannels.TRACKER_GET_STATS, context, start, end)
  },

  // Hardware profiling (AI Cookbook)
  hardware: {
    getSpecs: (): Promise<unknown> =>
      ipcRenderer.invoke(IpcChannels.HARDWARE_GET_SPECS)
  },

  // Ollama (AI Cookbook)
  ollama: {
    check: (): Promise<unknown> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_CHECK_INSTALLED),

    listLocal: (): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_LIST_LOCAL),

    pull: (modelTag: string, modelId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_PULL, modelTag, modelId),

    stop: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_STOP),

    delete: (modelTag: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_DELETE, modelTag),

    onPullProgress: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, event: unknown) => callback(event)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
    },

    onPullDone: (callback: (modelId: string) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, modelId: string) => callback(modelId)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_DONE, handler)
    },

    onPullError: (callback: (modelId: string, error: string) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, modelId: string, error: string) =>
        callback(modelId, error)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_ERROR, handler)
    }
  },

  cookbook: {
    getHardwareSpecs: (): Promise<HardwareSpecs> =>
      ipcRenderer.invoke(IpcChannels.HARDWARE_GET_SPECS),

    checkOllama: (): Promise<OllamaStatus> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_CHECK_INSTALLED),

    pullModel: (modelTag: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_PULL, modelTag),

    stopPull: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_STOP),

    listLocalModels: (): Promise<string[]> =>
      ipcRenderer.invoke(IpcChannels.OLLAMA_LIST_LOCAL),

    onPullProgress: (callback: (event: PullProgressEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, event: PullProgressEvent) => callback(event)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_PROGRESS, handler)
    },

    onPullDone: (callback: (data: { modelTag: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, data: { modelTag: string }) => callback(data)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_DONE, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_DONE, handler)
    },

    onPullError: (callback: (data: { modelTag: string; message: string }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, data: { modelTag: string; message: string }) => callback(data)
      ipcRenderer.on(IpcChannels.OLLAMA_PULL_ERROR, handler)
      return () => ipcRenderer.removeListener(IpcChannels.OLLAMA_PULL_ERROR, handler)
    }
  },

  notes: {
    listNotes: (): Promise<NoteMetadata[]> =>
      ipcRenderer.invoke(IpcChannels.NOTES_LIST),
    readNote: (title: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.NOTES_READ, title),
    writeNote: (title: string, content: string, oldTitle?: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.NOTES_WRITE, title, content, oldTitle),
    deleteNote: (title: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.NOTES_DELETE, title)
  },

  git: {
    checkRepo: (path: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.GIT_CHECK, path),
    getStatus: (path: string): Promise<GitStatusResult> =>
      ipcRenderer.invoke(IpcChannels.GIT_STATUS, path),
    getLog: (path: string): Promise<GitCommit[]> =>
      ipcRenderer.invoke(IpcChannels.GIT_LOG, path)
  },

  clipboard: {
    getHistory: async (): Promise<ClipboardItem[]> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_GET_HISTORY)
      if (!res.success) throw new Error(res.error)
      return res.data
    },
    togglePin: async (id: string, isPinned: boolean): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_TOGGLE_PIN, id, isPinned)
      if (!res.success) throw new Error(res.error)
    },
    updateLabel: async (id: string, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_UPDATE_LABEL, id, label)
      if (!res.success) throw new Error(res.error)
    },
    deleteItem: async (id: string): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_DELETE_ITEM, id)
      if (!res.success) throw new Error(res.error)
    },
    clearHistory: async (): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_CLEAR_HISTORY)
      if (!res.success) throw new Error(res.error)
    },
    createSnippet: async (content: string, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_CREATE_SNIPPET, content, label)
      if (!res.success) throw new Error(res.error)
    },
    restoreItem: async (content: string, isPinned: boolean, label: string | null): Promise<void> => {
      const res = await ipcRenderer.invoke(IpcChannels.CLIPBOARD_RESTORE_ITEM, content, isPinned, label)
      if (!res.success) throw new Error(res.error)
    },
    paste: (content: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CLIPBOARD_PASTE, content)
  },

  analytics: {
    getAnalytics: (): Promise<AnalyticsData> =>
      ipcRenderer.invoke(IpcChannels.ANALYTICS_GET_DATA)
  },

  customizer: {
    toggleEngine: (active: boolean): Promise<void> =>
      ipcRenderer.invoke('customizer:toggleEngine', active),
    getEngineState: (): Promise<boolean> =>
      ipcRenderer.invoke('customizer:getEngineState'),
    updateTheme: (vars: Record<string, string>): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_UPDATE_THEME, vars),
    getTheme: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke('customizer:getTheme'),
    getPlugins: (): Promise<PluginInfo[]> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_GET_PLUGINS),
    togglePlugin: (filename: string, active: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_TOGGLE_PLUGIN, filename, active),
    openPluginsFolder: (): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_OPEN_PLUGINS_FOLDER),
    registerShortcuts: (shortcuts: ShortcutMap): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CUSTOMIZER_REGISTER_SHORTCUTS, shortcuts),
    getShortcuts: (): Promise<ShortcutMap> =>
      ipcRenderer.invoke('customizer:getShortcuts')
  },

  cheatsheets: {
    list: (): Promise<Array<{ name: string; path: string; size: number; mtime: number }>> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_LIST),
    add: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_ADD, filePath),
    remove: (name: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_REMOVE, name),
    rename: (oldName: string, newName: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_RENAME, oldName, newName),
    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_SELECT),
    getText: (name: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.CHEATSHEETS_GET_TEXT, name)
  },
  gamedev: {
    batchRename: (files: Array<{ oldPath: string; newPath: string }>): Promise<{
      success: boolean
      renamedCount: number
      errors: Array<{ oldPath: string; newPath: string; error: string }>
    }> => ipcRenderer.invoke(IpcChannels.GAMEDEV_BATCH_RENAME, files),
    selectTexture: (): Promise<{ path: string; dataUrl: string } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SELECT_TEXTURE),
    loadTexture: (path: string): Promise<{ path: string; dataUrl: string } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_LOAD_TEXTURE, path),
    saveMaps: (params: { albedoPath: string; maps: { normal?: string; height?: string; roughness?: string; ao?: string } }): Promise<{ success: boolean; writtenFiles: string[]; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_MAPS, params),
    saveSeamless: (params: { originalPath: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SEAMLESS, params),
    selectSpriteFolder: (): Promise<{ path: string; files: Array<{ name: string; path: string; dataUrl: string }> } | null> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SELECT_SPRITE_FOLDER),
    saveSpriteAtlas: (params: { folderPath: string; atlasDataUrl: string; atlasJson: string }): Promise<{ success: boolean; pngPath?: string; jsonPath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SPRITE_ATLAS, params),
    saveSlices: (params: { originalPath: string; files: Array<{ index: number; dataUrl: string }> }): Promise<{ success: boolean; count: number; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_SLICES, params),
    saveLut: (params: { originalPath: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_LUT, params),
    saveUpscaled: (params: { originalPath: string; suffix: string; dataUrl: string }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      ipcRenderer.invoke(IpcChannels.GAMEDEV_SAVE_UPSCALED, params)
  },
  memory: {
    getMemories: (context?: string): Promise<any[]> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_MEMORIES, context),
    saveMemory: (payload: any): Promise<any> =>
      ipcRenderer.invoke(IpcChannels.AI_SAVE_MEMORY, payload),
    deleteMemory: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_DELETE_MEMORY, id),
    searchMemories: (query: string, context?: string, limit?: number): Promise<any[]> =>
      ipcRenderer.invoke(IpcChannels.AI_SEARCH_MEMORIES, query, context, limit),
    togglePinMemory: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_TOGGLE_PIN_MEMORY, id),
    updateMemoryContent: (id: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.AI_UPDATE_MEMORY_CONTENT, id, content),
    batchSaveMemories: (items: any[], context: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.AI_BATCH_SAVE_MEMORIES, items, context),
    consolidateMemory: (params: {
      context: string
      userText: string
      assistantText: string
      model: string
    }): Promise<any[]> => ipcRenderer.invoke(IpcChannels.AI_CONSOLIDATE_MEMORY, params)
  },
  workspace: {
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_SELECT_FOLDER),
    getStructure: (folderPath: string): Promise<any[]> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_GET_STRUCTURE, folderPath),
    readFile: (folderPath: string, relativePath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.WORKSPACE_READ_FILE, folderPath, relativePath)
  }
})
