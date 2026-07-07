/* eslint-disable */
import type {
  Item,
  Tag,
  CreateItemPayload,
  CreateTagPayload,
  PaginatedResult,
  Relation,
  RelationType,
  AiStreamParams,
  AiStructuredParams,
  AiStructuredResult,
  BulkUpdatePayload,
  SearchQuery,
  HardwareSpecs,
  PullProgressEvent,
  TaskQueryParams,
  OllamaStatus,
  FocusSession,
  CreateFocusSessionPayload,
  NoteMetadata,
  NoteSearchResult,
  GitCommit,
  GitStatusResult,
  ClipboardItem,
  AnalyticsData,
  PluginInfo,
  ShortcutMap
} from '../../shared/types'

export interface ElectronAPI {
  app: {
    platform: string
    versions: {
      electron: string
      node: string
      chrome: string
    }
    getVersion: () => Promise<string>
    getDataPath: () => Promise<string>
    openExternal: (url: string) => Promise<void>
    minimize: () => void
    maximize: () => void
    close: () => void
    saveFile: (defaultName: string, content: string) => Promise<boolean>
    showItemInFolder: (filePath: string) => Promise<void>
    getPathForFile: (file: File) => string
    onNavigateToView: (callback: (view: string) => void) => () => void
  }
  db: {
    getItems: (context: string, type: string, page: number, pageSize: number) => Promise<PaginatedResult<Item>>
    createItem: (payload: CreateItemPayload, tagIds?: string[]) => Promise<Item>
    updateItem: (id: string, patch: Partial<Item>, tagIds?: string[]) => Promise<Item>
    deleteItem: (id: string) => Promise<void>
    getTags: () => Promise<Tag[]>
    createTag: (payload: CreateTagPayload) => Promise<Tag>
    updateTag: (id: string, payload: Partial<CreateTagPayload>) => Promise<Tag>
    deleteTag: (id: string) => Promise<void>
    getSetting: (key: string) => Promise<unknown>
    setSetting: (key: string, value: unknown) => Promise<void>
    getRelations: (itemId: string) => Promise<Relation[]>
    createRelation: (fromId: string, toId: string, type: RelationType) => Promise<Relation>
    deleteRelation: (id: string) => Promise<void>
    searchItems: (query: SearchQuery) => Promise<PaginatedResult<Item>>
    getContexts: () => Promise<string[]>
    bulkUpdateItems: (payload: BulkUpdatePayload) => Promise<{ updated: number }>
    bulkDeleteItems: (ids: string[]) => Promise<{ deleted: number }>
    rebalancePositions: (context: string, status: string) => Promise<void>
    queryTasks: (context: string, params: TaskQueryParams) => Promise<PaginatedResult<Item>>
    createFocusSession: (payload: CreateFocusSessionPayload) => Promise<FocusSession>
    getFocusSessions: (context: string) => Promise<FocusSession[]>
    exportContext: (context: string, contextName: string) => Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>
    importContext: () => Promise<{ success: boolean; payload?: any; cancelled?: boolean; error?: string }>
    importContextData: (newContextSlug: string, data: any) => Promise<{ success: boolean; error?: string }>
  }
  ai: {
    startStream: (params: AiStreamParams, streamId?: string) => Promise<void>
    generateStructured: (params: AiStructuredParams) => Promise<AiStructuredResult>
    abortStructured: () => Promise<void>
    abortStream: (streamId?: string) => Promise<void>
    testConnection: (baseURL: string, apiKey: string) => Promise<{ success: boolean; error?: string }>
    onChunk: (callback: (chunk: string, streamId?: string) => void) => () => void
    onDone: (callback: (streamId?: string) => void) => () => void
    onError: (callback: (errMessage: string, streamId?: string) => void) => () => void
  }
  widget: {
    toggle: () => Promise<void>
    setPosition: (pos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => Promise<void>
    setOpacity: (opacity: number) => Promise<void>
  }
  onThemeUpdate: (callback: (css: string) => void) => () => void
  hud: {
    toggle: (active?: boolean) => Promise<void>
    onToggle: (callback: (visible: boolean) => void) => () => void
    onReset: (callback: () => void) => () => void
    resize: (height: number) => void
  }
  webhook: {
    toggle: (active: boolean, port: number) => Promise<void>
    onEvent: (callback: (payload: unknown) => void) => () => void
  }
  backup: {
    run: (action?: 'backup' | 'restore' | 'delete' | 'init', filename?: string) => Promise<void>
    getStatus: () => Promise<{
      enabled: boolean
      interval: string
      path: string
      maxCount: number
      backups: { filename: string; timestamp: number; size: number }[]
    }>
  }
  tracker: {
    toggle: (active: boolean) => Promise<void>
    getState: () => Promise<boolean>
    getActivityStats: (context: string | null, start: number, end: number) => Promise<{
      totalDurationMs: number
      byProcess: Array<{ processName: string; durationMs: number }>
      byContext: Array<{ context: string; durationMs: number }>
      byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
    }>
  }
  hardware: {
    getSpecs: () => Promise<HardwareSpecs>
  }
  ollama: {
    check: () => Promise<unknown>
    listLocal: () => Promise<string[]>
    pull: (modelTag: string, modelId: string) => Promise<void>
    stop: () => Promise<void>
    delete: (modelTag: string) => Promise<void>
    onPullProgress: (callback: (event: PullProgressEvent) => void) => () => void
    onPullDone: (callback: (modelId: string) => void) => () => void
    onPullError: (callback: (modelId: string, error: string) => void) => () => void
  }
  cookbook: {
    getHardwareSpecs: () => Promise<HardwareSpecs>
    checkOllama: () => Promise<OllamaStatus>
    pullModel: (modelTag: string) => Promise<void>
    stopPull: () => Promise<void>
    deleteModel: (modelTag: string) => Promise<boolean>
    listLocalModels: () => Promise<string[]>
    onPullProgress: (callback: (event: PullProgressEvent) => void) => () => void
    onPullDone: (callback: (data: { modelTag: string }) => void) => () => void
    onPullError: (callback: (data: { modelTag: string; message: string }) => void) => () => void
  }
  notes: {
    listNotes: () => Promise<NoteMetadata[]>
    readNote: (title: string) => Promise<string>
    writeNote: (title: string, content: string, oldTitle?: string) => Promise<void>
    deleteNote: (title: string) => Promise<void>
    searchNotes: (query: string) => Promise<NoteSearchResult[]>
  }
  git: {
    checkRepo: (path: string) => Promise<boolean>
    getStatus: (path: string) => Promise<GitStatusResult>
    getLog: (path: string) => Promise<GitCommit[]>
  }
  clipboard: {
    getHistory: () => Promise<ClipboardItem[]>
    togglePin: (id: string, isPinned: boolean) => Promise<void>
    updateLabel: (id: string, label: string | null) => Promise<void>
    deleteItem: (id: string) => Promise<void>
    restoreItem: (content: string, isPinned: boolean, label: string | null) => Promise<void>
    clearHistory: () => Promise<void>
    createSnippet: (content: string, label: string | null) => Promise<void>
    paste: (content: string) => Promise<void>
    onHistoryChanged: (callback: () => void) => () => void
  }
  analytics: {
    getAnalytics: (context?: string | null) => Promise<AnalyticsData>
  }
  customizer: {
    toggleEngine: (active: boolean) => Promise<void>
    getEngineState: () => Promise<boolean>
    updateTheme: (vars: Record<string, string>) => Promise<void>
    getTheme: () => Promise<Record<string, string>>
    getPlugins: () => Promise<PluginInfo[]>
    togglePlugin: (filename: string, active: boolean) => Promise<void>
    openPluginsFolder: () => Promise<void>
    registerShortcuts: (shortcuts: ShortcutMap) => Promise<void>
    getShortcuts: () => Promise<ShortcutMap>
  }
  cheatsheets: {
    list: () => Promise<Array<{ name: string; path: string; size: number; mtime: number }>>
    add: (filePath: string) => Promise<string>
    remove: (name: string) => Promise<void>
    rename: (oldName: string, newName: string) => Promise<void>
    selectFile: () => Promise<string | null>
    getText: (name: string) => Promise<string>
    getRelevant: (name: string, query: string, maxChars?: number) => Promise<string>
    search: (query: string) => Promise<Array<{ name: string; matchCount: number; snippets: string[] }>>
  }
  gamedev: {
    batchRename: (files: Array<{ oldPath: string; newPath: string }>) => Promise<{
      success: boolean
      renamedCount: number
      errors: Array<{ oldPath: string; newPath: string; error: string }>
    }>
    selectTexture: () => Promise<{ path: string; dataUrl: string } | null>
    loadTexture: (path: string) => Promise<{ path: string; dataUrl: string } | null>
    saveMaps: (params: { albedoPath: string; maps: { normal?: string; height?: string; roughness?: string; ao?: string } }) => Promise<{ success: boolean; writtenFiles: string[]; error?: string }>
    saveSeamless: (params: { originalPath: string; dataUrl: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
    selectSpriteFolder: () => Promise<{ path: string; files: Array<{ name: string; path: string; dataUrl: string }> } | null>
    saveSpriteAtlas: (params: { folderPath: string; atlasDataUrl: string; atlasJson: string }) => Promise<{ success: boolean; pngPath?: string; jsonPath?: string; error?: string }>
    saveSlices: (params: { originalPath: string; files: Array<{ index: number; dataUrl: string }> }) => Promise<{ success: boolean; count: number; error?: string }>
    saveLut: (params: { originalPath: string; dataUrl: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
    saveUpscaled: (params: { originalPath: string; suffix: string; dataUrl: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  }
  memory: {
    getMemories: (context?: string) => Promise<any[]>
    saveMemory: (payload: any) => Promise<any>
    deleteMemory: (id: string) => Promise<boolean>
    searchMemories: (query: string, context?: string, limit?: number) => Promise<any[]>
    togglePinMemory: (id: string) => Promise<boolean>
    updateMemoryContent: (id: string, content: string) => Promise<boolean>
    batchSaveMemories: (items: any[], context: string) => Promise<void>
    pruneMemories: (context: string, limit: number) => Promise<void>
    auditMemories: (context: string, model: string) => Promise<any[]>
    consolidateMemory: (params: {
      context: string
      userText: string
      assistantText: string
      model: string
    }) => Promise<any[]>
  }
  workspace: {
    selectFolder: () => Promise<string | null>
    getStructure: (folderPath: string) => Promise<any[]>
    readFile: (folderPath: string, relativePath: string) => Promise<string>
  }
  media: {
    saveFromBuffer: (arrayBuffer: ArrayBuffer, extension: string) => Promise<string>
    saveFilePaths: (filePaths: string[]) => Promise<Array<{ originalPath: string; filename: string }>>
    scanAndPrune: () => Promise<{
      scannedCount: number
      prunedCount: number
      spaceSavedBytes: number
      prunedFiles: string[]
    }>
    getStorageInfo: () => Promise<{ fileCount: number; totalSize: number; path: string }>
  }
  sync: {
    startHost: (port?: number) => Promise<void>
    stopHost: () => Promise<void>
    connectAndSync: (hostIp: string, port: number, pairingCode: string) => Promise<{ dbUpdates: number; filesSynced: number }>
    getStatus: () => Promise<{
      active: boolean
      port: number
      pairingCode: string
      progress: string
      isSyncing: boolean
    }>
    getDiscoveredPeers: () => Promise<Array<{ name: string; ip: string; port: number; lastSeen: number }>>
    getDbPayload: () => Promise<{
      items: any[]
      tags: any[]
      item_tags: any[]
      relations: any[]
      app_settings: any[]
      focus_sessions: any[]
      clipboard_items: any[]
      tombstones: Array<{ id: string; table_name: string; deleted_at: number }>
    }>
    applyDbPayload: (payload: {
      items: any[]
      tags: any[]
      item_tags: any[]
      relations: any[]
      app_settings: any[]
      focus_sessions: any[]
      clipboard_items: any[]
      tombstones: Array<{ id: string; table_name: string; deleted_at: number }>
    }) => Promise<{ pulledNewerCount: number }>
    getFileIndex: (subDir: 'notes' | 'media') => Promise<Array<{ relPath: string; mtime: number; size: number; sha256: string }>>
    readFileChunk: (subDir: 'notes' | 'media', relPath: string) => Promise<Uint8Array | null>
    writeFileChunk: (subDir: 'notes' | 'media', relPath: string, buffer: ArrayBuffer, mtime?: number) => Promise<void>
    deleteFile: (subDir: 'notes' | 'media', relPath: string) => Promise<void>
    applyBoardBaseline: (
      context: string,
      items: any[],
      tags: any[],
      itemTags: any[],
      relations: any[]
    ) => Promise<void>
    applyRemoteMutation: (mutation: any) => Promise<void>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }

  interface ImportMeta {
    readonly env: {
      readonly DEV: boolean
      readonly PROD: boolean
      readonly MODE: string
      readonly [key: string]: string | boolean | undefined
    }
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag' | 'inherit'
  }
}

