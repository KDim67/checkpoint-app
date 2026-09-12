import { ipcMain } from 'electron'
import { normalizeMemoryActions, type MemoryAction } from '../shared/memoryActions'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import type Database from 'better-sqlite3'
import { IpcChannels } from '../shared/ipcChannels'
import type { AiMemory, CreateMemoryPayload } from '../shared/types'

// Re-exported: this module owned the definition before the preload and the
// renderer needed it too, and existing importers still reach for it here.
export type { AiMemory } from '../shared/types'

/** The row as SQLite actually returns it, before is_pinned is normalised. */
type AiMemoryRow = Omit<AiMemory, 'is_pinned'> & { is_pinned: number }

// Module-level prepared statement singletons
// All initialized once in initMemoryStatements(), never inside a per-call function.
let stmtGetMemories: Database.Statement
let stmtGetExistingByKey: Database.Statement
let stmtUpdateMemory: Database.Statement
let stmtInsertMemory: Database.Statement
let stmtGetPinState: Database.Statement
let stmtTogglePin: Database.Statement
let stmtUpdateContent: Database.Statement
let stmtDeleteMemory: Database.Statement
let stmtIncrementAccess: Database.Statement
let stmtPruneCount: Database.Statement
let stmtPruneSelect: Database.Statement
let stmtPruneDelete: Database.Statement
let stmtActionDelete: Database.Statement
let stmtActionUpdate: Database.Statement

function initMemoryStatements(): void {
  const db = getDb()
  stmtGetMemories = db.prepare(`
    SELECT id, context, category, memory_key, content, is_pinned, access_count, created_at, updated_at
    FROM ai_memories
    WHERE context = ? OR context = 'global'
    ORDER BY is_pinned DESC, updated_at DESC
    LIMIT 200
  `)
  stmtGetExistingByKey = db.prepare(
    `SELECT id, access_count, created_at FROM ai_memories WHERE context = ? AND memory_key = ?`
  )
  stmtUpdateMemory = db.prepare(
    `UPDATE ai_memories SET category = ?, content = ?, is_pinned = ?, updated_at = ? WHERE id = ?`
  )
  stmtInsertMemory = db.prepare(
    `INSERT INTO ai_memories (id, context, category, memory_key, content, is_pinned, access_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
  stmtGetPinState = db.prepare(`SELECT is_pinned FROM ai_memories WHERE id = ?`)
  stmtTogglePin = db.prepare(`UPDATE ai_memories SET is_pinned = ?, updated_at = ? WHERE id = ?`)
  stmtUpdateContent = db.prepare(`UPDATE ai_memories SET content = ?, updated_at = ? WHERE id = ?`)
  stmtDeleteMemory = db.prepare(`DELETE FROM ai_memories WHERE id = ?`)
  stmtIncrementAccess = db.prepare(`UPDATE ai_memories SET access_count = access_count + 1 WHERE id = ?`)
  stmtPruneCount = db.prepare(`SELECT COUNT(*) as cnt FROM ai_memories WHERE context = ?`)
  stmtPruneSelect = db.prepare(`
    SELECT id FROM ai_memories
    WHERE context = ? AND is_pinned = 0
    ORDER BY access_count ASC, updated_at ASC
    LIMIT ?
  `)
  stmtPruneDelete = db.prepare(`DELETE FROM ai_memories WHERE id = ?`)
  stmtActionDelete = db.prepare(`DELETE FROM ai_memories WHERE context = ? AND memory_key = ?`)
  stmtActionUpdate = db.prepare(
    `UPDATE ai_memories SET content = ?, updated_at = ? WHERE context = ? AND memory_key = ?`
  )
}

export function getMemories(context: string = 'default'): AiMemory[] {
  const rows = stmtGetMemories.all(context) as AiMemoryRow[]
  return rows.map(r => ({
    ...r,
    is_pinned: Boolean(r.is_pinned)
  }))
}

export function saveMemory(payload: {
  id?: string
  context?: string
  category?: 'semantic' | 'episodic' | 'working'
  memory_key: string
  content: string
  is_pinned?: boolean
}): AiMemory {
  const now = Date.now()
  const context = payload.context || 'default'
  const category = payload.category || 'semantic'
  const is_pinned = payload.is_pinned ? 1 : 0
  const key = payload.memory_key.trim().toLowerCase().slice(0, 120)

  const existing = stmtGetExistingByKey.get(context, key) as { id: string; access_count: number; created_at: number } | undefined

  if (payload.id || existing) {
    const id = payload.id || existing!.id
    stmtUpdateMemory.run(category, payload.content, is_pinned, now, id)
    return {
      id,
      context,
      category,
      memory_key: key,
      content: payload.content,
      is_pinned: Boolean(is_pinned),
      access_count: existing?.access_count || 0,
      created_at: existing?.created_at || now,
      updated_at: now
    }
  } else {
    const id = uuidv4()
    stmtInsertMemory.run(id, context, category, key, payload.content, is_pinned, now, now)
    return {
      id,
      context,
      category,
      memory_key: key,
      content: payload.content,
      is_pinned: Boolean(is_pinned),
      access_count: 0,
      created_at: now,
      updated_at: now
    }
  }
}

export function togglePinMemory(id: string): boolean {
  const row = stmtGetPinState.get(id) as { is_pinned: number } | undefined
  if (!row) return false
  const newPin = row.is_pinned ? 0 : 1
  stmtTogglePin.run(newPin, Date.now(), id)
  return Boolean(newPin)
}

export function updateMemoryContent(id: string, content: string): boolean {
  const res = stmtUpdateContent.run(content, Date.now(), id)
  return res.changes > 0
}

export function deleteMemory(id: string): boolean {
  const res = stmtDeleteMemory.run(id)
  return res.changes > 0
}

/**
 * 3-Tier Semantic Vector Memory Search using TF-IDF cosine similarity.
 * Tier 1. Pinned (semantic): always surfaced first
 * Tier 2. Semantic: project facts, lore, rules, high weight
 * Tier 3. Episodic: past decisions, milestones
 * Working memories excluded from recall (they are session-only scratchpads)
 */
export function searchMemories(query: string, context: string = 'default', limit: number = 8): AiMemory[] {
  const memories = getMemories(context)
  if (!query || memories.length === 0) return memories.slice(0, limit)

  // Exclude pure working memories from recall (they are scratchpads, not durable)
  const recallable = memories.filter(m => m.category !== 'working')

  const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'have', 'has', 'not', 'but', 'from', 'they', 'will', 'been', 'all', 'its', 'you', 'your'])
  const tokenize = (text: string) =>
    text.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !stopWords.has(t))

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return recallable.slice(0, limit)

  // Build IDF weights from corpus
  const docFreq: Record<string, number> = {}
  for (const mem of recallable) {
    const tokens = new Set(tokenize(`${mem.memory_key} ${mem.content}`))
    for (const t of tokens) {
      docFreq[t] = (docFreq[t] || 0) + 1
    }
  }
  const N = recallable.length
  const idf = (t: string) => Math.log((N + 1) / ((docFreq[t] || 0) + 1)) + 1

  const scored = recallable.map(mem => {
    const text = `${mem.memory_key} ${mem.content}`
    const memTokens = tokenize(text)
    const termFreq: Record<string, number> = {}
    for (const t of memTokens) termFreq[t] = (termFreq[t] || 0) + 1
    const maxTf = Math.max(...Object.values(termFreq), 1)

    // TF-IDF cosine similarity
    let dotProduct = 0
    let memMagnitude = 0
    let queryMagnitude = 0

    for (const qt of queryTokens) {
      const tf = (termFreq[qt] || 0) / maxTf
      const tfidf = tf * idf(qt)
      dotProduct += tfidf * idf(qt)
      queryMagnitude += idf(qt) ** 2
    }
    for (const qt of Object.keys(termFreq)) {
      const tf = termFreq[qt] / maxTf
      memMagnitude += (tf * idf(qt)) ** 2
    }
    const cosineSim = (memMagnitude > 0 && queryMagnitude > 0)
      ? dotProduct / (Math.sqrt(memMagnitude) * Math.sqrt(queryMagnitude))
      : 0

    // Tier boosts
    let tierBoost = 0
    if (mem.is_pinned) tierBoost += 2.5
    if (mem.category === 'semantic') tierBoost += 0.8
    if (mem.category === 'episodic') tierBoost += 0.4

    // Recency decay: memories updated in last 7 days get a small boost
    const daysSinceUpdate = (Date.now() - mem.updated_at) / (1000 * 60 * 60 * 24)
    const recencyBoost = Math.max(0, 0.3 - daysSinceUpdate * 0.04)

    // Access frequency boost (popular memories are more relevant)
    const accessBoost = Math.min(0.5, mem.access_count * 0.05)

    const score = cosineSim + tierBoost + recencyBoost + accessBoost
    return { mem, score }
  })

  scored.sort((a, b) => b.score - a.score)

  // Increment access_count for retrieved memories
  const topResults = scored.filter(s => s.score > 0.01).map(s => s.mem).slice(0, limit)
  for (const item of topResults) {
    try { stmtIncrementAccess.run(item.id) } catch {}
  }

  return topResults.length > 0 ? topResults : recallable.slice(0, Math.min(limit, 3))
}

/**
 * Sequential processing of AI-directed memory adjustments (save, update, delete).
 */
function processMemoryActions(actions: MemoryAction[], context: string): void {
  for (const item of actions) {
    try {
      const key = item.memory_key
      if (item.action === 'delete') {
        stmtActionDelete.run(context, key)
      } else if (item.action === 'update' && item.content) {
        stmtActionUpdate.run(
          item.content.slice(0, 2000),
          Date.now(),
          context,
          key
        )
      } else if (item.action === 'save' && item.content) {
        saveMemory({
          context,
          category: item.category || 'semantic',
          memory_key: key,
          content: item.content
        })
      }
    } catch (e) {
      console.warn('[MemoryService] Failed to process memory action:', e)
    }
  }
}

/**
 * Prunes the database to enforce memory limits (40 for small models, 120 for large).
 * Evicts oldest unpinned memories first.
 */
function pruneMemories(context: string = 'default', limit: number = 40): void {
  const countRow = stmtPruneCount.get(context) as { cnt: number }
  if (countRow.cnt <= limit) return

  const excess = countRow.cnt - limit
  const toDelete = stmtPruneSelect.all(context, excess) as Array<{ id: string }>
  if (toDelete.length === 0) return

  const db = getDb()
  const transaction = db.transaction((ids: Array<{ id: string }>) => {
    for (const item of ids) {
      stmtPruneDelete.run(item.id)
    }
  })
  transaction(toDelete)
}

/**
 * Audit pass: asks the AI to inspect all active memories to resolve redundancies, contradictions, or stale information.
 */
export async function auditMemories(context: string, model: string): Promise<AiMemory[]> {
  const existingMems = getMemories(context)
  if (existingMems.length === 0) return []

  const auditPrompt = `You are an AI memory auditor. Review the following list of active memories for this workspace. Identify redundancies, obsolete items, or contradictions.

ACTIVE MEMORIES:
${existingMems.map(m => `- Key: "${m.memory_key}" [Category: ${m.category}]: "${m.content}"`).join('\n')}

For any issues found, specify "delete" or "update" actions.
Return ONLY a JSON array of actions (no explanation, no markdown):
[
  { "action": "delete", "memory_key": "key_to_delete" },
  { "action": "update", "memory_key": "key_to_update", "content": "updated merged/simplified content" }
]
Return [] if all memories are clean and relevant.`

  try {
    const { runCompletion } = await import('./aiService')
    const raw = await runCompletion({
      model,
      messages: [{ role: 'user', content: auditPrompt }],
      temperature: 0.1,
      maxTokens: 1000
    })

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let jsonString = cleaned
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (arrayMatch) {
      jsonString = arrayMatch[0]
    }

    // Normalised, not merely parsed. These actions delete and rewrite rows,
    // and what comes back is a model's guess at a shape.
    let actions: MemoryAction[] = []
    try {
      actions = normalizeMemoryActions(JSON.parse(jsonString))
    } catch {
      return existingMems
    }

    if (actions.length > 0) {
      processMemoryActions(actions, context)
    }
    // Prune after consolidation/audit as well
    const isSmall = model.toLowerCase().includes('2b') || model.toLowerCase().includes('3b') || model.toLowerCase().includes('7b') || model.toLowerCase().includes('8b') || model.toLowerCase().includes('phi') || model.toLowerCase().includes('gemma') || model.toLowerCase().includes('llama3:8b')
    pruneMemories(context, isSmall ? 40 : 120)

    return getMemories(context)
  } catch (e) {
    console.warn('[MemoryService] Audit memories failed:', e)
    return existingMems
  }
}

/**
 * Runs the AI memory-extraction pass for a single user/assistant exchange and
 * saves/updates/deletes whatever durable facts come back.
 */
export async function consolidateFromExchange(params: {
  context: string
  userText: string
  assistantText: string
  model: string
}): Promise<AiMemory[]> {
  const context = params.context || 'default'
  const combinedLength = (params.userText?.length || 0) + (params.assistantText?.length || 0)
  if (combinedLength < 200) return []
  if (!params.model) return []

  const existingMems = getMemories(context)

  const consolidationPrompt = `You are an AI memory extraction and optimization specialist. Analyze this conversation exchange and determine how to update your long-term memories.

CONVERSATION:
User: ${params.userText.slice(0, 1500)}
Assistant: ${params.assistantText.slice(0, 1500)}

EXISTING MEMORIES:
${existingMems.map(m => `- [${m.category.toUpperCase()}] Key: "${m.memory_key}": "${m.content}"`).join('\n') || '(none yet)'}

You can perform three actions:
1. "save": Record a brand new fact.
2. "update": Modify an existing memory if the conversation corrects, refines, or updates it.
3. "delete": Delete an existing memory if it is directly contradicted, obsolete, or no longer true.

Return ONLY a JSON array of actions (no explanation, no markdown):
[
  {
    "action": "save",
    "category": "semantic",
    "memory_key": "short_descriptive_key",
    "content": "The fact to remember in 1-2 sentences"
  },
  {
    "action": "update",
    "memory_key": "existing_key_to_update",
    "content": "The corrected or updated memory content"
  },
  {
    "action": "delete",
    "memory_key": "existing_key_to_delete"
  }
]

Keep keys concise (under 60 chars), content brief (under 300 chars). Return [] if no memory adjustments are needed.`

  try {
    const { runCompletion } = await import('./aiService')
    const raw = await runCompletion({
      model: params.model,
      messages: [{ role: 'user', content: consolidationPrompt }],
      temperature: 0.2,
      maxTokens: 800
    })

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let jsonString = cleaned
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (arrayMatch) {
      jsonString = arrayMatch[0]
    }

    // Normalised, not merely parsed. These actions delete and rewrite rows,
    // and what comes back is a model's guess at a shape.
    let actions: MemoryAction[] = []
    try {
      actions = normalizeMemoryActions(JSON.parse(jsonString))
    } catch {
      return []
    }

    if (actions.length === 0) return []

    processMemoryActions(actions, context)

    // Enforce size limits dynamically based on model size
    const isSmall = params.model.toLowerCase().includes('2b') || params.model.toLowerCase().includes('3b') || params.model.toLowerCase().includes('7b') || params.model.toLowerCase().includes('8b') || params.model.toLowerCase().includes('phi') || params.model.toLowerCase().includes('gemma') || params.model.toLowerCase().includes('llama3:8b')
    pruneMemories(context, isSmall ? 40 : 120)

    return getMemories(context)
  } catch (e) {
    console.warn('[MemoryService] Consolidation pass failed:', e)
    return []
  }
}

export function initMemoryIpc(): void {
  // Initialize all prepared statements once at startup
  initMemoryStatements()

  ipcMain.handle(IpcChannels.AI_GET_MEMORIES, (_event, context?: string) => {
    return getMemories(context)
  })

  ipcMain.handle(IpcChannels.AI_SAVE_MEMORY, (_event, payload: CreateMemoryPayload) => {
    return saveMemory(payload)
  })

  ipcMain.handle(IpcChannels.AI_DELETE_MEMORY, (_event, id: string) => {
    return deleteMemory(id)
  })

  ipcMain.handle(IpcChannels.AI_SEARCH_MEMORIES, (_event, query: string, context?: string, limit?: number) => {
    return searchMemories(query, context, limit)
  })

  ipcMain.handle(IpcChannels.AI_TOGGLE_PIN_MEMORY, (_event, id: string) => {
    return togglePinMemory(id)
  })

  ipcMain.handle(IpcChannels.AI_UPDATE_MEMORY_CONTENT, (_event, id: string, content: string) => {
    return updateMemoryContent(id, content)
  })

  ipcMain.handle(IpcChannels.AI_AUDIT_MEMORIES, (_event, context: string, model: string) => {
    return auditMemories(context, model)
  })

  ipcMain.handle(IpcChannels.AI_CONSOLIDATE_MEMORY, (_event, params: {
    context: string
    userText: string
    assistantText: string
    model: string
  }) => {
    return consolidateFromExchange(params)
  })
}
