/**
 * All shared domain types for Checkpoint.
 * This file is imported by BOTH the main process and the renderer.
 * Do NOT use Node.js-specific types (Buffer, NodeJS.*) here.
 */

// Core Domain Types

export type ItemType = 'log' | 'card' | 'task'
export type ItemStatus = string
export type ItemPriority = 0 | 1 | 2 | 3 // 0=none, 1=low, 2=med, 3=high
export type RelationType = 'blocks' | 'relates_to' | 'duplicates'

export interface Item {
  id: string             // UUID v4
  type: ItemType
  context: string        // e.g. 'dayjob' | 'unity-project' | 'personal'
  title: string
  body: string           // Markdown content
  status: ItemStatus
  priority: ItemPriority
  position: number       // fractional index for drag-and-drop ordering
  created_at: number     // Unix timestamp ms
  updated_at: number     // Unix timestamp ms
  due_at: number | null  // nullable Unix timestamp ms
  metadata: string       // JSON string for type-specific extensions
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

export interface AppSetting {
  key: string
  value: string          // JSON-stringified value
}

export type MemoryCategory = 'semantic' | 'episodic' | 'working'

/** A row of `ai_memories`. What the assistant has remembered about a workspace. */
export interface AiMemory {
  id: string
  context: string
  category: MemoryCategory
  memory_key: string
  content: string
  /**
   * SQLite stores this as 0 or 1; memoryService normalises it before the row
   * leaves the main process, so everything downstream sees a real boolean.
   */
  is_pinned: boolean
  access_count: number
  created_at: number
  updated_at: number
}

export type CreateMemoryPayload = Pick<AiMemory, 'context' | 'category' | 'memory_key' | 'content'>

/** One file in an imported workspace folder. */
export interface WorkspaceFileInfo {
  name: string
  relativePath: string
  extension: string
  size: number
}

/**
 * A whole workspace, as written by Export and read by Import.
 *
 * `item_tags` is the join table verbatim rather than tags nested inside items:
 * the import replays it into the same table, and flattening it there and
 * rebuilding it here would be work that could only introduce discrepancies.
 */
export interface ContextExport {
  version: number
  context: string
  items: Item[]
  tags: Tag[]
  item_tags: { item_id: string; tag_id: string }[]
  relations: Relation[]
  /**
   * The workspace's own settings. Board columns, background, swimlanes,
   * backlog layout and every wall. Keyed as stored, with values as stored.
   *
   * Absent in a version 1 export, which is why it is optional: those files
   * still import, they just arrive with default columns the way they always
   * did.
   */
  settings?: Record<string, string>
}

/** A row of `sync_tombstones`. A deletion, so peers can replay it. */
export interface SyncTombstone {
  id: string
  table_name: string
  deleted_at: number
}

/**
 * The whole database as it travels between paired machines.
 *
 * Every field is the table verbatim. `app_settings` has already been filtered
 * by `shared/syncSettings` before it gets here. Credentials and machine-local
 * rows never reach this shape.
 */
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

export interface ActivityLog {
  id: string
  context: string
  window_title: string
  process_name: string
  duration_ms: number
  captured_at: number
}

// Pagination

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// AI

/** Multimodal content part (OpenAI-compatible). Used for vision-model image input. */
export type AiContentPart =
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

/** Real token counts, when the endpoint reports them via stream_options. */
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

// Structured AI actions (reliable board/plan/dialogue/update generation)

export type AiStructuredKind = 'board' | 'plan' | 'dialogue' | 'update' | 'config'

export interface AiStructuredParams {
  kind: AiStructuredKind
  model: string
  messages: AiChatMessage[]
  temperature?: number
}

export interface AiStructuredResult {
  ok: boolean
  /** Parsed JSON object whose shape depends on `kind`. */
  data?: unknown
  /** Which generation strategy succeeded: tools | json_schema | json_object | text. */
  method?: string
  error?: string
}

// AI Cookbook / Hardware

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

/** Model capabilities used for filtering and capability badges. */
export type ModelCapability = 'chat' | 'code' | 'reasoning' | 'vision' | 'tools' | 'embedding'

export interface CatalogModel {
  id: string
  name: string
  family: string
  parameters: number
  description: string
  useCases: string[]
  homepageUrl: string
  /** Not every model ships every quantization on Ollama, so variants are partial. */
  variants: Partial<Record<QuantizationLevel, ModelVariant>>
  /** Capabilities for filtering + badges (tools = function calling, vision = multimodal). */
  capabilities?: ModelCapability[]
  /** Max context window in tokens. */
  contextLength?: number
  /** License short name, e.g. "Apache 2.0", "MIT", "Llama 3.1". */
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

// Bulk Operations

export interface BulkUpdatePayload {
  ids: string[]
  patch: Partial<Pick<Item, 'status' | 'priority' | 'context'>>
}

// Search

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
  /** When true, returns only archived (soft-deleted) tasks instead of the normal active set. */
  archivedOnly?: boolean
  /**
   * Only tasks with no due date. Distinct from an open dueStart/dueEnd range,
   * which a task without a date can never satisfy.
   */
  noDueDate?: boolean
  /** Only tasks carrying no tags at all, which tagIds cannot express. */
  untagged?: boolean
}

export interface FocusSession {
  id: string
  context: string
  duration_ms: number
  completed_at: number
  notes: string
  tasks_json: string // JSON array of selected task titles/details
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
  /** Short plain-text preview of the note body (markdown stripped). */
  excerpt: string
}

export interface NoteSearchResult {
  title: string
  /** Contextual snippet around the first content match, with markers stripped. */
  snippet: string
  /** Number of matches of the query within the note body. */
  matchCount: number
  /** True when the query also matches the note title. */
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

/**
 * What a manual update check found.
 *
 * `unsupported` is a dev run: only the packaged app has a release to compare
 * itself against. The version on `current` is the one already installed; on
 * `available` it is the newer one now downloading.
 */
export type UpdateCheckResult =
  | { status: 'unsupported' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string }





