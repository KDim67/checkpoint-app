// Deterministic enrichment for AI-generated board/plan/dialogue output.
//
// The model's structured JSON (from ai.generateStructured) is guaranteed to be
// valid, but a small model may still omit tags, colors, or good priorities.
// These helpers guarantee a visually rich, consistent result regardless of the
// model's capability, every column gets a color, every card gets 1-3 colored
// tags, and package the result into the exact fenced-block format the existing
// ChatMessage executor understands.

export type StructuredKind = 'board' | 'plan' | 'dialogue' | 'update'

// Palette
const NAMED_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', gray: '#6b7280', slate: '#64748b'
}

// Rotatable palette for stable hashing (readable on the dark board)
const PALETTE = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4',
  '#8b5cf6', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#f43f5e'
]

/** Palette summary injected into prompts so the model reaches for real colors. */
export const PALETTE_HINT =
  'Use hex colors from this palette: #3b82f6 (blue), #a855f7 (purple), #22c55e (green), ' +
  '#f59e0b (amber), #ec4899 (pink), #06b6d4 (cyan), #14b8a6 (teal), #f97316 (orange), ' +
  '#6366f1 (indigo), #ef4444 (red), #84cc16 (lime), #eab308 (yellow).'

function resolveColor(val?: unknown): string | null {
  if (typeof val !== 'string') return null
  const v = val.trim()
  if (!v) return null
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v
  if (v.startsWith('rgb')) return v
  return NAMED_COLORS[v.toLowerCase()] ?? null
}

function stableColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

// Semantic column colors (by name keyword)
const COLUMN_COLOR_RULES: Array<{ test: RegExp; color: string }> = [
  { test: /backlog|todo|to do|inbox|idea|new/i, color: '#64748b' },
  { test: /progress|doing|active|wip|develop|build/i, color: '#3b82f6' },
  { test: /review|qa|test|verify|approv/i, color: '#f59e0b' },
  { test: /block|hold|waiting|stuck/i, color: '#ef4444' },
  { test: /done|complete|ship|release|closed|live/i, color: '#22c55e' },
  { test: /design|art|ux|ui/i, color: '#a855f7' },
  { test: /research|spike|discovery|explore/i, color: '#06b6d4' }
]

function colorForColumn(name: string, index: number): string {
  for (const rule of COLUMN_COLOR_RULES) if (rule.test.test(name)) return rule.color
  return PALETTE[index % PALETTE.length]
}

// Tag inference (keyword → topical tag)
const TAG_RULES: Array<{ test: RegExp; tag: string }> = [
  { test: /\b(bug|fix|crash|error|regression|broken)\b/i, tag: 'bug' },
  { test: /\b(ui|hud|menu|button|screen|layout|widget)\b/i, tag: 'ui' },
  { test: /\b(audio|sound|music|sfx|voice)\b/i, tag: 'audio' },
  { test: /\b(art|sprite|texture|model|shader|vfx|particle|animation|anim)\b/i, tag: 'art' },
  { test: /\b(gameplay|mechanic|combat|movement|jump|physics|control)\b/i, tag: 'gameplay' },
  { test: /\b(level|map|world|environment|biome|room|dungeon)\b/i, tag: 'level-design' },
  { test: /\b(story|narrative|dialogue|quest|lore|cutscene|character)\b/i, tag: 'narrative' },
  { test: /\b(perf|performance|optimi|fps|memory|profil|lag)\b/i, tag: 'performance' },
  { test: /\b(network|multiplayer|server|netcode|sync|online)\b/i, tag: 'networking' },
  { test: /\b(ai|enemy|npc|pathfind|behavior|behaviour)\b/i, tag: 'ai' },
  { test: /\b(save|load|persist|serialize|database|db)\b/i, tag: 'systems' },
  { test: /\b(inventory|shop|economy|loot|item|currency)\b/i, tag: 'systems' },
  { test: /\b(input|controller|keyboard|gamepad|touch)\b/i, tag: 'input' },
  { test: /\b(test|qa|coverage|unit test)\b/i, tag: 'testing' },
  { test: /\b(refactor|cleanup|tech debt|debt|rewrite)\b/i, tag: 'refactor' },
  { test: /\b(doc|documentation|readme|comment)\b/i, tag: 'docs' },
  { test: /\b(setup|config|infra|ci|cd|build|pipeline|deploy)\b/i, tag: 'infra' },
  { test: /\b(research|spike|investigate|prototype|explore)\b/i, tag: 'research' },
  { test: /\b(design|wireframe|mockup|ux)\b/i, tag: 'design' },
  { test: /\b(balanc|tuning|difficulty)\b/i, tag: 'balancing' }
]

const TAG_COLORS: Record<string, string> = {
  bug: '#ef4444', ui: '#3b82f6', audio: '#8b5cf6', art: '#ec4899',
  gameplay: '#22c55e', 'level-design': '#f59e0b', narrative: '#a855f7',
  performance: '#f97316', networking: '#06b6d4', ai: '#6366f1',
  systems: '#14b8a6', input: '#0ea5e9', testing: '#84cc16', refactor: '#64748b',
  docs: '#94a3b8', infra: '#64748b', research: '#06b6d4', design: '#a855f7',
  balancing: '#eab308', general: '#64748b'
}

function tagColor(name: string): string {
  return TAG_COLORS[name.toLowerCase()] ?? stableColor(name)
}

function inferTags(title: string, body: string): string[] {
  const text = `${title} ${body}`
  const found: string[] = []
  for (const rule of TAG_RULES) {
    if (rule.test.test(text) && !found.includes(rule.tag)) found.push(rule.tag)
    if (found.length >= 3) break
  }
  return found
}

// Types for the normalized output
interface Tag { name: string; color: string }
interface EnrichedCard { title: string; body: string; status: string; priority: number; tags: Tag[]; due?: string }
interface EnrichedColumn { name: string; wipLimit: number | null; color: string; colorMode: string }

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

function normalizeTags(raw: unknown, title: string, body: string): Tag[] {
  const out: Tag[] = []
  const seen = new Set<string>()
  const add = (name: string, color?: string): void => {
    const clean = name.trim().replace(/^#/, '')
    if (!clean || seen.has(clean.toLowerCase())) return
    seen.add(clean.toLowerCase())
    out.push({ name: clean, color: resolveColor(color) ?? tagColor(clean) })
  }

  for (const t of asArray(raw)) {
    if (typeof t === 'string') add(t)
    else {
      const o = asObject(t)
      if (o) add(str(o.name || o.label || o.tag), o.color as string | undefined)
    }
  }

  // Guarantee at least one tag, infer from content, else a sensible default.
  if (out.length === 0) {
    const inferred = inferTags(title, body)
    if (inferred.length > 0) inferred.forEach(t => add(t))
    else add('general')
  }
  return out.slice(0, 3)
}

// Public: normalize + enrich a board plan
export interface EnrichedBoard {
  message: string
  columns: EnrichedColumn[]
  cards: EnrichedCard[]
}

export function enrichBoard(raw: unknown): EnrichedBoard | null {
  const obj = asObject(raw)
  if (!obj) return null

  // Cards can appear under several keys
  const rawCards = asArray(obj.cards ?? obj.tasks ?? obj.items)
  const rawCols = asArray(obj.columns ?? obj.stages ?? obj.lists)

  const columns: EnrichedColumn[] = []
  rawCols.forEach((c, i) => {
    const o = asObject(c)
    if (!o) return
    const name = str(o.name || o.column_name || o.title || o.stage_name).trim()
    if (!name) return
    const wipRaw = o.wipLimit ?? o.wip_limit
    columns.push({
      name,
      wipLimit: typeof wipRaw === 'number' ? wipRaw : null,
      color: resolveColor(o.color) ?? colorForColumn(name, i),
      colorMode: ['header', 'full', 'none'].includes(str(o.colorMode || o.color_mode)) ? str(o.colorMode || o.color_mode) : 'header'
    })
  })

  const cards: EnrichedCard[] = []
  for (const c of rawCards) {
    const o = asObject(c)
    if (!o) continue
    const title = str(o.title || o.card_name || o.task_name || o.card_title || o.name).trim()
    if (!title) continue
    const body = str(o.body || o.description || o.details || o.content).trim()
    let priority = Number(o.priority)
    if (!Number.isFinite(priority) || priority < 1 || priority > 3) priority = 2
    const due = str(o.due || o.due_date || o.deadline).trim()
    cards.push({
      title,
      body,
      status: str(o.status || o.column || o.stage || 'open').trim() || 'open',
      priority: Math.round(priority),
      tags: normalizeTags(o.tags, title, body),
      ...(due && !Number.isNaN(Date.parse(due)) ? { due } : {})
    })
  }

  if (cards.length === 0 && columns.length === 0) return null

  const parts: string[] = []
  if (cards.length) parts.push(`${cards.length} card${cards.length === 1 ? '' : 's'}`)
  if (columns.length) parts.push(`${columns.length} column${columns.length === 1 ? '' : 's'}`)
  const message = str(obj.message).trim() || `Added ${parts.join(' and ')} to your board.`

  return { message, columns, cards }
}

// Public: normalize a plan
export function normalizePlan(raw: unknown): { message: string; block: object } | null {
  const obj = asObject(raw)
  if (!obj) return null
  const steps = asArray(obj.steps).map((s, i) => {
    const o = asObject(s) || {}
    return {
      title: str(o.title || o.name || `Step ${i + 1}`).trim(),
      details: str(o.details || o.description || o.body).trim(),
      status: ['pending', 'in_progress', 'done'].includes(str(o.status)) ? str(o.status) : 'pending'
    }
  }).filter(s => s.title)
  if (steps.length === 0) return null
  const title = str(obj.title).trim() || 'Implementation Plan'
  const overview = str(obj.overview || obj.summary).trim()
  const message = str(obj.message).trim() || `Here's a plan for "${title}".`
  return { message, block: { title, overview, steps } }
}

// Public: normalize a dialogue tree (and repair dangling targets)
export function normalizeDialogue(raw: unknown): { message: string; block: object } | null {
  const obj = asObject(raw)
  if (!obj) return null
  const nodes = asArray(obj.nodes).map(n => {
    const o = asObject(n) || {}
    return {
      id: str(o.id).trim(),
      speaker: str(o.speaker || o.name || 'NPC').trim(),
      text: str(o.text || o.line || o.dialogue).trim(),
      choices: asArray(o.choices).map(ch => {
        const co = asObject(ch) || {}
        return { text: str(co.text || co.label).trim(), target: str(co.target || co.next || 'end').trim() }
      }).filter(ch => ch.text)
    }
  }).filter(n => n.id && n.text)
  if (nodes.length === 0) return null

  const ids = new Set(nodes.map(n => n.id))
  // Repair any choice pointing at a non-existent node → terminate that branch.
  for (const n of nodes) {
    for (const ch of n.choices) {
      if (ch.target !== 'end' && !ids.has(ch.target)) ch.target = 'end'
    }
  }
  const startNode = ids.has(str(obj.startNode).trim()) ? str(obj.startNode).trim() : nodes[0].id
  const message = str(obj.message).trim() || `Here's a branching dialogue with ${nodes.length} nodes.`
  return { message, block: { startNode, nodes } }
}

// Public: normalize board-edit operations
export type BoardOp = 'move' | 'set_priority' | 'retitle' | 'update_body' | 'archive' | 'set_due_date'

export interface UpdateOperation {
  op: BoardOp
  target: string
  toColumn?: string
  priority?: number
  newTitle?: string
  newBody?: string
  /** ISO date string for set_due_date; empty string clears the due date. */
  due?: string
}

const VALID_OPS: BoardOp[] = ['move', 'set_priority', 'retitle', 'update_body', 'archive', 'set_due_date']

export function normalizeUpdate(raw: unknown): { message: string; operations: UpdateOperation[] } | null {
  const obj = asObject(raw)
  if (!obj) return null
  const operations: UpdateOperation[] = []
  for (const o of asArray(obj.operations ?? obj.ops ?? obj.changes ?? obj.edits)) {
    const e = asObject(o)
    if (!e) continue
    const op = str(e.op || e.action || e.type).trim().toLowerCase().replace(/[\s-]+/g, '_') as BoardOp
    const target = str(e.target || e.title || e.card).trim()
    if (!VALID_OPS.includes(op) || !target) continue
    const entry: UpdateOperation = { op, target }
    if (op === 'move') {
      const to = str(e.toColumn ?? e.to_column ?? e.to ?? e.column ?? e.destination).trim()
      if (!to) continue
      entry.toColumn = to
    } else if (op === 'set_priority') {
      const p = Math.round(Number(e.priority ?? e.value))
      if (!Number.isFinite(p) || p < 1 || p > 3) continue
      entry.priority = p
    } else if (op === 'retitle') {
      const nt = str(e.newTitle ?? e.new_title ?? e.to ?? e.value).trim()
      if (!nt) continue
      entry.newTitle = nt
    } else if (op === 'update_body') {
      const nb = str(e.newBody ?? e.new_body ?? e.body ?? e.value).trim()
      if (!nb) continue
      entry.newBody = nb
    } else if (op === 'set_due_date') {
      const due = str(e.due ?? e.dueDate ?? e.due_date ?? e.date ?? e.value).trim()
      // Empty clears the due date; anything else must be a parseable date.
      if (due && Number.isNaN(Date.parse(due))) continue
      entry.due = due
    }
    operations.push(entry)
  }
  if (operations.length === 0) return null
  const message = str(obj.message).trim() || `Applying ${operations.length} change${operations.length === 1 ? '' : 's'} to the board.`
  return { message, operations }
}

// Public: build the assistant message content the executor renders
export function buildAssistantMessage(kind: StructuredKind, raw: unknown): string | null {
  if (kind === 'board') {
    const b = enrichBoard(raw)
    if (!b) return null
    const payload: Record<string, unknown> = { cards: b.cards }
    if (b.columns.length > 0) payload.columns = b.columns
    return `${b.message}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
  }
  if (kind === 'plan') {
    const p = normalizePlan(raw)
    if (!p) return null
    return `${p.message}\n\n\`\`\`json:create_plan\n${JSON.stringify(p.block, null, 2)}\n\`\`\``
  }
  if (kind === 'dialogue') {
    const d = normalizeDialogue(raw)
    if (!d) return null
    return `${d.message}\n\n\`\`\`json:create_dialogue_tree\n${JSON.stringify(d.block, null, 2)}\n\`\`\``
  }
  if (kind === 'update') {
    const u = normalizeUpdate(raw)
    if (!u) return null
    return `${u.message}\n\n\`\`\`json:update_board\n${JSON.stringify({ operations: u.operations }, null, 2)}\n\`\`\``
  }
  return null
}
