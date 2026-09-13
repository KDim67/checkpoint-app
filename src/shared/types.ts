/** imported by main and renderer, no Node types */

export type ItemType = 'log' | 'card' | 'task'
type ItemStatus = string
export type ItemPriority = 0 | 1 | 2 | 3 // 0=none, 1=low, 2=med, 3=high
export type RelationType = 'blocks' | 'relates_to' | 'duplicates'

export interface Item {
  id: string             // UUID v4
  type: ItemType
  /** context is the column and payload name; the UI says workspace (see appStore) */
  context: string        // e.g. 'dayjob' | 'unity-project' | 'personal'
  title: string
  body: string           // markdown
  status: ItemStatus
  priority: ItemPriority
  position: number       // fractional index for drag-and-drop ordering
  created_at: number     // unix ms
  updated_at: number     // unix ms
  due_at: number | null  // nullable unix ms
  metadata: string       // JSON string, per-type extensions
  tags?: Tag[]           // populated by join queries
}

export type CreateItemPayload = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'tags'>

export interface Tag {
  id: string
  name: string
  color: string          // hex color, e.g. '#535e85'
}

export type CreateTagPayload = Omit<Tag, 'id'>

export interface Relation {
  id: string
  from_id: string
  to_id: string
  type: RelationType
}

interface AppSetting {
  key: string
  value: string          // JSON-stringified value
}

export type MemoryCategory = 'semantic' | 'episodic' | 'working'

/** what the assistant remembered about a workspace */
export interface AiMemory {
  id: string
  context: string
  category: MemoryCategory
  memory_key: string
  content: string
  /** 0/1 in SQLite, normalised before leaving main */
  is_pinned: boolean
  access_count: number
  created_at: number
  updated_at: number
}

export type CreateMemoryPayload = Pick<AiMemory, 'context' | 'category' | 'memory_key' | 'content'>

/** one file in an imported folder */
export interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

/** item_tags kept verbatim so import replays it directly */
export interface ContextExport {
  version: number
  context: string
  items: Item[]
  tags: Tag[]
  item_tags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  /** board, backlog and walls, as stored; missing in v1 exports */
  settings?: Record<string, string>
}

/** a deletion peers can replay */
export interface SyncTombstone {
  id: string
  table_name: string
  deleted_at: number
}

/** tables verbatim; settings already filtered by syncSettings */
export interface SyncPayload {
  items: Item[]
  tags: Tag[]
  item_tags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  app_settings: AppSetting[]
  focus_sessions: FocusSession[]
  clipboard_items: ClipboardItem[]
  tombstones: SyncTombstone[]
}

export interface Context {
  slug: string           // e.g. 'unity-project'
  name: string           // e.g. 'Unity Project'
  color: string          // hex
  icon?: string          // emoji or icon name
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** OpenAI-compatible, for vision input */
type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AiContentPart[]
}

export interface AiStreamParams {
  model: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
}

/** when the endpoint reports them */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AiSettings {
  baseURL: string        // e.g. 'http://localhost:11434/v1' for Ollama
  apiKey: string         // 'ollama' for local, real key for OpenAI
  model: string
}

export type AiStructuredKind = 'board' | 'plan' | 'dialogue' | 'update' | 'config'

export interface AiStructuredParams {
  kind: AiStructuredKind
  model: string
  messages: AiChatMessage[]
  temperature?: number
}

export interface AiStructuredResult {
  ok: boolean
  /** shape depends on kind */
  data?: unknown
  /** which strategy worked */
  method?: string
  error?: string
}

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown'

export interface HardwareSpecs {
  ramGb: number
  cpuCores: number
  cpuThreads: number
  gpuVendor: GpuVendor
  gpuName: string
  vramGb: number
  platform: string       // 'win32' | 'darwin' | 'linux'
}

export type QuantizationLevel = 'q4' | 'q8' | 'f16'
export type FitStatus = 'optimal' | 'tight' | 'cpu_offload' | 'not_recommended'

export interface ModelVariant {
  quantization: QuantizationLevel
  ramRequiredGb: number
  vramRequiredGb: number
  fileSizeGb: number
  ollamaTag: string
}

export interface FitResult {
  status: FitStatus
  score: number          // 0–100
  reason: string
  recommendedVariant: QuantizationLevel
}

/** for filters and badges */
type ModelCapability = 'chat' | 'code' | 'reasoning' | 'vision' | 'tools' | 'embedding'

export interface CatalogModel {
  id: string
  name: string
  family: string
  parameters: number
  description: string
  useCases: string[]
  homepageUrl: string
  /** not every quantization ships */
  variants: Partial<Record<QuantizationLevel, ModelVariant>>
  /** tools means function calling, vision multimodal */
  capabilities?: ModelCapability[]
  /** in tokens */
  contextLength?: number
  /** e.g. "Apache 2.0" */
  license?: string
}

export interface OllamaStatus {
  installed: boolean
  running: boolean
  downloadUrl: string
  localModels: string[]
}

export interface PullProgressEvent {
  modelId: string
  status: string
  completedBytes: number
  totalBytes: number
  percent: number        // 0–100, -1 if total unknown
}

export interface BulkUpdatePayload {
  ids: string[]
  patch: Partial<Pick<Item, 'status' | 'priority' | 'context'>>
}

export interface SearchQuery {
  query: string
  context?: string
  type?: ItemType
  status?: ItemStatus
  page?: number
  pageSize?: number
}

export interface TaskQueryParams {
  query?: string
  status?: string[]
  priority?: number[]
  tagIds?: string[]
  dueStart?: number | null
  dueEnd?: number | null
  hasRelations?: boolean | null
  sortBy?: string
  sortDesc?: boolean
  page?: number
  pageSize?: number
  /** archived only */
  archivedOnly?: boolean
  /** no due date, which a range can't express */
  noDueDate?: boolean
  /** no tags, which tagIds can't express */
  untagged?: boolean
}

export interface FocusSession {
  id: string
  context: string
  duration_ms: number
  completed_at: number
  notes: string
  tasks_json: string // JSON array of selected tasks
}

export interface CreateFocusSessionPayload {
  context: string
  duration_ms: number
  notes: string
  tasks_json: string
}

export interface NoteMetadata {
  title: string
  tags: string[]
  links: string[]
  updatedAt: number
  size: number
  /** markdown stripped */
  excerpt: string
}

export interface NoteSearchResult {
  title: string
  /** around the first content match */
  snippet: string
  /** matches in the body */
  matchCount: number
  /** the title matches too */
  titleMatch: boolean
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export interface GitStatusResult {
  branch: string
  changesCount: number
  installed: boolean
}

export interface ClipboardItem {
  id: string
  content: string
  is_pinned: number // 0 = false, 1 = true
  label: string | null
  created_at: number
}

export interface AnalyticsData {
  focusStats: {
    totalSessions: number
    totalDurationMins: number
    avgSessionMins: number
  }
  tasksCompletedWeekly: Array<{
    week: string
    count: number
  }>
  logHeatmap: Array<{
    date: string
    count: number
  }>
  mostUsedTags: Array<{
    name: string
    color: string
    count: number
  }>
  columnTime: Array<{
    column: string
    avgMs: number
    count?: number
  }>
  recentFocusSessions: Array<{
    completedAt: number
    durationMinutes: number
    notes: string
    context: string
  }>
  activityAllocation: Array<{
    context: string
    durationMins: number
  }>
}

export interface PluginInfo {
  filename: string
  name: string
  description: string
  version: string
  active: boolean
}

export type ShortcutMap = Record<string, string>;

/** byte counts ride along so both surfaces can say time left */
export type UpdateProgress =
  | {
      phase: 'downloading'
      version: string
      percent: number
      transferred: number
      total: number
      /** averaged over the download by electron-updater */
      bytesPerSecond: number
    }
  | { phase: 'ready'; version: string }

/** unsupported means a dev run; current is installed, available is downloading */
export type UpdateCheckResult =
  | { status: 'unsupported' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string }
