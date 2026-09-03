/**
 * The assistant panel's pure logic: token estimation, history pruning, intent
 * classification, skill detection and response parsing.
 *
 * Split out of AiStreamPanel.tsx, where it sat above a 3,600-line component and
 * could not be tested without rendering one. Nothing here touches React, the
 * DOM or IPC, every function is input in, value out, which is what makes the
 * regex-heavy parts (classifyIntent especially) worth pinning down in tests.
 *
 * Moved verbatim. Behaviour is unchanged by construction.
 */

import { detectVisionFromName } from '../../../../shared/modelCapabilities'
import type { IntentType, Message } from './types'


/**
 * Name-only fallback, for the model dropdown where a per-entry IPC probe would
 * be wasteful. The live model uses discovered capabilities via
 * useModelCapabilities; this is only a hint for models the user has not
 * selected yet.
 */
export function supportsVision(modelName: string): boolean {
  return detectVisionFromName(modelName)
}

export function parseThinkingAndContent(text: string) {
  let thinking = ''
  let content = text

  let thinkStartIdx = -1
  let tagLength = 0
  let endTag = ''

  const startTags = [
    { tag: '<think>', end: '</think>' },
    { tag: '<thought>', end: '</thought>' },
    { tag: '<thinking>', end: '</thinking>' }
  ]

  for (const item of startTags) {
    const idx = text.indexOf(item.tag)
    if (idx !== -1 && (thinkStartIdx === -1 || idx < thinkStartIdx)) {
      thinkStartIdx = idx
      tagLength = item.tag.length
      endTag = item.end
    }
  }

  if (thinkStartIdx !== -1) {
    const thinkEndIdx = text.indexOf(endTag)
    if (thinkEndIdx !== -1) {
      thinking = text.slice(thinkStartIdx + tagLength, thinkEndIdx).trim()
      content = (text.slice(0, thinkStartIdx) + text.slice(thinkEndIdx + endTag.length)).trim()
    } else {
      thinking = text.slice(thinkStartIdx + tagLength).trim()
      content = text.slice(0, thinkStartIdx).trim()
    }
  }
  return { thinking, content }
}

// Rough, fast token estimate, no tokenizer dependency.
//
// A flat 4 chars/token holds for Latin prose but understates CJK badly: those
// codepoints cost roughly a token each, so a Chinese conversation was reported
// at a quarter of its real size and blew the context window without warning.
// Counted separately, then combined.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = text.match(CJK_RE)?.length ?? 0
  const rest = text.length - cjkCount
  return Math.ceil(cjkCount + rest / 4)
}

/**
 * Prunes the conversation history to fit within a maximum token limit,
 * keeping the newest messages at the end. Always preserves the latest user query.
 */
export function pruneHistory(history: Message[], maxHistoryTokens: number): Message[] {
  if (history.length === 0) return []
  const pruned: Message[] = []
  let estimatedTokens = 0

  // Always include the latest turn (the most recent user message)
  const lastMsg = history[history.length - 1]
  pruned.push(lastMsg)
  estimatedTokens += estimateTokens(lastMsg.content)

  // Iterate backwards starting from the second to last message
  for (let i = history.length - 2; i >= 0; i--) {
    const msg = history[i]
    const tokens = estimateTokens(msg.content)
    if (estimatedTokens + tokens > maxHistoryTokens) {
      break
    }
    estimatedTokens += tokens
    pruned.unshift(msg)
  }

  return pruned
}

// Semantic intent classifier, replaces the fragile keyword-heuristic approach.
// Returns what action type the model should take, factoring in the active skill.
// Defaults to 'converse' to prevent hallucination when intent is ambiguous.
export function classifyIntent(text: string, activeSkillId: string | null): IntentType {
  const lower = text.toLowerCase().trim()

  // Board CONFIGURATION signals (columns, background, swimlanes, card fields).
  // Checked before card editing because the two share verbs, "set", "change",
  // "rename", and only the noun distinguishes "rename the card" from "rename
  // the column". The column/board nouns are therefore required here.
  if (
    /\b(wip|work in progress)\b[\s\S]{0,20}\blimit\b/.test(lower) ||
    /\blimit\b[\s\S]{0,30}\b(column|list|lane)\b/.test(lower) ||
    /\b(rename|delete|remove|add|create|reorder|move|collapse|expand|colou?r)\b[\s\S]{0,40}\b(column|list|lane)\b/.test(lower) ||
    /\b(column|list|lane)\b[\s\S]{0,40}\b(colou?r|order|sort|limit|description|definition of done)\b/.test(lower) ||
    /\b(board|kanban)\b[\s\S]{0,30}\b(background|theme|colou?r)\b/.test(lower) ||
    /\bswimlane/.test(lower) ||
    /\b(hide|show)\b[\s\S]{0,30}\b(tags?|due dates?|priorit(y|ies)|body|preview)\b[\s\S]{0,30}\bcards?\b/.test(lower) ||
    /\bcards?\b[\s\S]{0,20}\b(fields?|face)\b/.test(lower)
  ) return 'configure_board'

  // Board EDITING signals (existing cards), checked before creation so
  // "move X to done" never reads as a create request. High-precision patterns.
  if (
    /\b(move|put|shift|transfer)\b[\s\S]{0,60}\b(to|into|in)\b[\s\S]{0,40}\b(column|done|progress|review|backlog|lane|stage)\b/.test(lower) ||
    /\barchive\b[\s\S]{0,60}\b(card|task|item|column|everything|all|done)\b/.test(lower) ||
    /\b(set|change|bump|raise|lower|update|increase|decrease)\b[\s\S]{0,50}\bpriorit/.test(lower) ||
    /\bmark\b[\s\S]{0,60}\bas\b[\s\S]{0,20}\b(done|complete|completed|finished|in.progress|review)\b/.test(lower) ||
    /\brename\b[\s\S]{0,60}\b(card|task|item)\b/.test(lower) ||
    /\b(reprioriti[sz]e|re-prioriti[sz]e)\b/.test(lower) ||
    /\b(set|change|add|update|clear|remove|push|extend)\b[\s\S]{0,50}\b(due date|deadline|due)\b/.test(lower) ||
    /\b(due|deadline)\b[\s\S]{0,30}\b(to|for|on|by)\b[\s\S]{0,30}\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|\d)/.test(lower)
  ) return 'update_items'

  // Skill-specific intent elevation: active skill biases strongly toward its native format
  if (activeSkillId === 'narrative_specialist') {
    const dialogueTriggers = ['dialogue', 'dialog', 'quest', 'story', 'narrative', 'write', 'create', 'generate', 'design', 'character', 'npc', 'scene', 'conversation', 'lore', 'plot']
    if (dialogueTriggers.some(t => lower.includes(t))) return 'create_dialogue'
  }
  if (activeSkillId === 'implementation_planner') {
    const planTriggers = ['plan', 'implement', 'build', 'design', 'system', 'feature', 'how', 'approach', 'steps', 'architect', 'refactor', 'create', 'generate', 'scaffold']
    if (planTriggers.some(t => lower.includes(t))) return 'create_plan'
  }

  // High-confidence dialogue signals (explicit multi-word patterns)
  if (/dialogue tree|quest flow|branching dialogue|npc dialogue|create.*dialogue|dialogue.*for|conversation.*tree/.test(lower)) return 'create_dialogue'

  // High-confidence plan signals
  if (/implementation plan|create.*plan|make.*plan|step.by.step plan|detailed plan|plan for/.test(lower)) return 'create_plan'

  // Item creation: requires BOTH an imperative verb AND an item noun (high-precision pairing)
  const CREATE_VERBS = ['create', 'add', 'make', 'generate', 'build', 'populate', 'set up', 'scaffold', 'give me', 'suggest', 'produce']
  const ITEM_NOUNS  = ['card', 'task', 'column', 'board', 'ticket', 'item', 'stage', 'more task', 'another task', 'some task', 'few task']
  const hasCreateVerb = CREATE_VERBS.some(v => lower.includes(v))
  const hasItemNoun   = ITEM_NOUNS.some(n => lower.includes(n))
  if (hasCreateVerb && hasItemNoun) return 'create_items'

  // "more" / "another" as standalone follow-up → create more of whatever the current topic is
  if (/^(more|add more|another|give me more|a few more|some more)/.test(lower)) return 'create_items'

  // Default to conversational, only output JSON when explicitly requested
  return 'converse'
}

// Automatic skill recall, infers which specialized skill best fits the message
// so the user never has to manually pick one (they still can, to pin it).
export function detectSkill(text: string): string | null {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return null

  const scores: Record<string, number> = {
    narrative_specialist: 0,
    implementation_planner: 0,
    kanban_architect: 0
  }
  const bump = (id: string, kws: string[], w = 1): void => {
    for (const k of kws) if (t.includes(k)) scores[id] += w
  }

  bump('narrative_specialist', ['dialogue', 'dialog', 'quest', 'story', 'narrative', 'lore', 'npc', 'cutscene', 'worldbuild', 'character arc', 'branching', 'conversation tree'], 2)
  bump('narrative_specialist', ['character', 'plot', 'scene', 'voice'])

  bump('implementation_planner', ['implementation plan', 'step-by-step', 'step by step', 'roadmap', 'architecture', 'design doc', 'technical spec', 'how should i build', 'how do i implement', 'approach for'], 2)
  bump('implementation_planner', ['plan', 'implement', 'architect', 'refactor', 'strategy', 'milestone'])

  bump('kanban_architect', ['column', 'columns', 'board', 'kanban', 'backlog', 'sprint', 'workflow', 'lane', 'wip', 'swimlane', 'pipeline stage'], 2)
  bump('kanban_architect', ['card', 'cards', 'task', 'tasks', 'ticket', 'prioriti', 'organize', 'break down'])

  let best: string | null = null
  let bestScore = 0
  for (const [id, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = id }
  }
  return bestScore >= 2 ? best : null
}

/** True when the user is asking for board structure (columns/stages/lanes), not just cards. */
export function wantsColumns(text: string): boolean {
  return /\b(column|columns|lane|lanes|stage|stages|swimlane|set ?up (a|the|my)? ?board|board structure|workflow|pipeline|restructure)\b/i.test(text || '')
}

/**
 * Helper to parse assistant response content and extract the exact card titles
 * and column names that the AI attempted to create.
 */
export function getAIEntitiesFromMessage(content: string): { cardTitles: string[]; columnNames: string[] } {
  const cardTitles: string[] = []
  const columnNames: string[] = []

  // Regex to extract text inside ```json ... ``` blocks
  const regex = /```json(?::\w+)?\s*([\s\S]*?)\s*```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    try {
      const jsonText = match[1].trim()
      const parsed = JSON.parse(jsonText)
      
      if (parsed && typeof parsed === 'object') {
        // 1. Batch format
        if (Array.isArray(parsed.cards)) {
          parsed.cards.forEach((c: any) => {
            if (c && c.title) cardTitles.push(c.title.trim())
          })
        }
        if (Array.isArray(parsed.columns)) {
          parsed.columns.forEach((col: any) => {
            if (col && col.name) columnNames.push(col.name.trim())
          })
        }

        // 2. Single card format
        if (parsed.title && !parsed.cards) {
          cardTitles.push(parsed.title.trim())
        }

        // 3. Single column format
        if (parsed.name && !parsed.columns) {
          columnNames.push(parsed.name.trim())
        }
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return { cardTitles, columnNames }
}
