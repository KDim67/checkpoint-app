import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import { IpcChannels } from '../shared/ipcChannels'

export interface AiMemory {
  id: string
  context: string
  category: 'semantic' | 'episodic' | 'working'
  memory_key: string
  content: string
  is_pinned: boolean
  access_count: number
  created_at: number
  updated_at: number
}

export function getMemories(context: string = 'default'): AiMemory[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT id, context, category, memory_key, content, is_pinned, access_count, created_at, updated_at
    FROM ai_memories
    WHERE context = ? OR context = 'global'
    ORDER BY is_pinned DESC, updated_at DESC
    LIMIT 200
  `)
  const rows = stmt.all(context) as any[]
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
  const db = getDb()
  const now = Date.now()
  const context = payload.context || 'default'
  const category = payload.category || 'semantic'
  const is_pinned = payload.is_pinned ? 1 : 0
  const key = payload.memory_key.trim().toLowerCase().slice(0, 120)

  const existingStmt = db.prepare(`SELECT id, access_count, created_at FROM ai_memories WHERE context = ? AND memory_key = ?`)
  const existing = existingStmt.get(context, key) as { id: string; access_count: number; created_at: number } | undefined

  if (payload.id || existing) {
    const id = payload.id || existing!.id
    const updateStmt = db.prepare(`
      UPDATE ai_memories
      SET category = ?, content = ?, is_pinned = ?, updated_at = ?
      WHERE id = ?
    `)
    updateStmt.run(category, payload.content, is_pinned, now, id)
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
    const insertStmt = db.prepare(`
      INSERT INTO ai_memories (id, context, category, memory_key, content, is_pinned, access_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)
    insertStmt.run(id, context, category, key, payload.content, is_pinned, now, now)
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
  const db = getDb()
  const row = db.prepare(`SELECT is_pinned FROM ai_memories WHERE id = ?`).get(id) as { is_pinned: number } | undefined
  if (!row) return false
  const newPin = row.is_pinned ? 0 : 1
  db.prepare(`UPDATE ai_memories SET is_pinned = ?, updated_at = ? WHERE id = ?`).run(newPin, Date.now(), id)
  return Boolean(newPin)
}

export function updateMemoryContent(id: string, content: string): boolean {
  const db = getDb()
  const res = db.prepare(`UPDATE ai_memories SET content = ?, updated_at = ? WHERE id = ?`).run(content, Date.now(), id)
  return res.changes > 0
}

export function deleteMemory(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare(`DELETE FROM ai_memories WHERE id = ?`)
  const res = stmt.run(id)
  return res.changes > 0
}

/**
 * 3-Tier Semantic Vector Memory Search using TF-IDF cosine similarity.
 * Tier 1, Pinned (semantic): always surfaced first
 * Tier 2, Semantic: project facts, lore, rules, high weight
 * Tier 3, Episodic: past decisions, milestones
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
  const db = getDb()
  const incStmt = db.prepare(`UPDATE ai_memories SET access_count = access_count + 1 WHERE id = ?`)
  const topResults = scored.filter(s => s.score > 0.01).map(s => s.mem).slice(0, limit)
  for (const item of topResults) {
    try { incStmt.run(item.id) } catch (e) {}
  }

  return topResults.length > 0 ? topResults : recallable.slice(0, Math.min(limit, 3))
}

/**
 * Batch-save memories extracted by the AI consolidation pass.
 * Accepts an array of {category, memory_key, content} objects.
 */
export function batchSaveMemories(
  items: Array<{ category: 'semantic' | 'episodic' | 'working'; memory_key: string; content: string }>,
  context: string
): void {
  for (const item of items) {
    try {
      saveMemory({
        context,
        category: item.category,
        memory_key: item.memory_key.slice(0, 120),
        content: item.content.slice(0, 2000)
      })
    } catch (e) {
      console.warn('[MemoryService] Failed to save memory item:', e)
    }
  }
}

/**
 * Runs the AI memory-extraction pass for a single user/assistant exchange and
 * saves whatever durable facts come back. This used to be done from the renderer
 * by importing the `openai` package directly there, but the OpenAI SDK refuses
 * to construct a client in a browser-like context (which Electron's renderer is),
 * so that call always threw and was silently swallowed. Nothing was ever actually
 * being written. Running it here, in the main process, the same place every other
 * model call in the app already happens, fixes that for real.
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
  const existingKeys = existingMems.map(m => m.memory_key).slice(0, 60).join(', ')

  const consolidationPrompt = `You are an AI memory extraction specialist. Analyze this conversation exchange and extract important, durable facts to remember for future conversations.

CONVERSATION:
User: ${params.userText.slice(0, 1500)}
Assistant: ${params.assistantText.slice(0, 1500)}

ALREADY KNOWN FACTS (do NOT repeat these): ${existingKeys || 'none yet'}

Extract 0–4 important facts worth remembering. Focus on:
- Project decisions, game design choices, rules, constraints
- User preferences, workflow patterns
- Key task/feature descriptions
- Important milestones or decisions made

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "category": "semantic",
    "memory_key": "short_descriptive_key",
    "content": "The fact to remember in 1-2 sentences"
  }
]

Categories: "semantic" (project facts/rules/lore), "episodic" (decisions/milestones), "working" (temp session state).
Return [] if nothing important to save. Keep memory_key under 60 chars, content under 300 chars.`

  try {
    const { runCompletion } = await import('./aiService')
    const raw = await runCompletion({
      model: params.model,
      messages: [{ role: 'user', content: consolidationPrompt }],
      temperature: 0.2,
      maxTokens: 600
    })

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let jsonString = cleaned
    // Extract only the JSON array block to tolerate conversational prefixes/suffixes from smaller models
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (arrayMatch) {
      jsonString = arrayMatch[0]
    }

    let extracted: Array<{ category: 'semantic' | 'episodic' | 'working'; memory_key: string; content: string }> = []
    try {
      const parsed = JSON.parse(jsonString)
      if (Array.isArray(parsed)) extracted = parsed
    } catch {
      return [] // Model didn't return valid JSON, nothing to save, fail silently
    }

    if (extracted.length === 0) return []

    batchSaveMemories(extracted, context)
    return getMemories(context)
  } catch (e) {
    console.warn('[MemoryService] Consolidation pass failed:', e)
    return []
  }
}

export function initMemoryIpc(): void {
  ipcMain.handle(IpcChannels.AI_GET_MEMORIES, (_event, context?: string) => {
    return getMemories(context)
  })

  ipcMain.handle(IpcChannels.AI_SAVE_MEMORY, (_event, payload: any) => {
    return saveMemory(payload)
  })

  ipcMain.handle(IpcChannels.AI_DELETE_MEMORY, (_event, id: string) => {
    return deleteMemory(id)
  })

  ipcMain.handle(IpcChannels.AI_SEARCH_MEMORIES, (_event, query: string, context?: string, limit?: number) => {
    return searchMemories(query, context, limit)
  })

  ipcMain.handle('ai:togglePinMemory', (_event, id: string) => {
    return togglePinMemory(id)
  })

  ipcMain.handle('ai:updateMemoryContent', (_event, id: string, content: string) => {
    return updateMemoryContent(id, content)
  })

  ipcMain.handle('ai:batchSaveMemories', (_event, items: any[], context: string) => {
    return batchSaveMemories(items, context)
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
