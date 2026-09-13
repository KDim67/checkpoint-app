/** pure logic split out of a 3,600-line component so the regex parts are testable */

import { detectVisionFromName } from '../../../../shared/modelCapabilities'
import type { IntentType, Message } from './types'


/** name-only hint for the dropdown; the live model uses discovered capabilities */
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

// no tokenizer; 4 chars/token undercounts CJK badly, so count those apart
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = text.match(CJK_RE)?.length ?? 0
  const rest = text.length - cjkCount
  return Math.ceil(cjkCount + rest / 4)
}

/** newest kept, latest user message always */
export function pruneHistory(history: Message[], maxHistoryTokens: number): Message[] {
  if (history.length === 0) return []
  const pruned: Message[] = []
  let estimatedTokens = 0

  const lastMsg = history[history.length - 1]
  pruned.push(lastMsg)
  estimatedTokens += estimateTokens(lastMsg.content)

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

// defaults to converse when ambiguous, the active skill biases it
export function classifyIntent(text: string, activeSkillId: string | null): IntentType {
  const lower = text.toLowerCase().trim()

  // config before editing: they share verbs, only the column/board noun tells them apart
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

  // editing before creation so "move X to done" isn't a create
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

  // the active skill biases toward its native format
  if (activeSkillId === 'narrative_specialist') {
    const dialogueTriggers = ['dialogue', 'dialog', 'quest', 'story', 'narrative', 'write', 'create', 'generate', 'design', 'character', 'npc', 'scene', 'conversation', 'lore', 'plot']
    if (dialogueTriggers.some(t => lower.includes(t))) return 'create_dialogue'
  }
  if (activeSkillId === 'implementation_planner') {
    const planTriggers = ['plan', 'implement', 'build', 'design', 'system', 'feature', 'how', 'approach', 'steps', 'architect', 'refactor', 'create', 'generate', 'scaffold']
    if (planTriggers.some(t => lower.includes(t))) return 'create_plan'
  }

  // explicit multi-word patterns only
  if (/dialogue tree|quest flow|branching dialogue|npc dialogue|create.*dialogue|dialogue.*for|conversation.*tree/.test(lower)) return 'create_dialogue'

  if (/implementation plan|create.*plan|make.*plan|step.by.step plan|detailed plan|plan for/.test(lower)) return 'create_plan'

  // needs both a verb and an item noun
  const CREATE_VERBS = ['create', 'add', 'make', 'generate', 'build', 'populate', 'set up', 'scaffold', 'give me', 'suggest', 'produce']
  const ITEM_NOUNS  = ['card', 'task', 'column', 'board', 'ticket', 'item', 'stage', 'more task', 'another task', 'some task', 'few task']
  const hasCreateVerb = CREATE_VERBS.some(v => lower.includes(v))
  const hasItemNoun   = ITEM_NOUNS.some(n => lower.includes(n))
  if (hasCreateVerb && hasItemNoun) return 'create_items'

  // bare "more"/"another" means more of the current topic
  if (/^(more|add more|another|give me more|a few more|some more)/.test(lower)) return 'create_items'

  // JSON only when explicitly asked
  return 'converse'
}

// so the user never has to pick a skill, though they can pin one
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

/** board structure, not just cards */
export function wantsColumns(text: string): boolean {
  return /\b(column|columns|lane|lanes|stage|stages|swimlane|set ?up (a|the|my)? ?board|board structure|workflow|pipeline|restructure)\b/i.test(text || '')
}

export function getAIEntitiesFromMessage(content: string): { cardTitles: string[]; columnNames: string[] } {
  const cardTitles: string[] = []
  const columnNames: string[] = []

  const regex = /```json(?::\w+)?\s*([\s\S]*?)\s*```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    try {
      const jsonText = match[1].trim()
      const parsed = JSON.parse(jsonText)
      
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.cards)) {
          // model output, check every field
          parsed.cards.forEach((c: unknown) => {
            const title = (c as { title?: unknown })?.title
            if (typeof title === 'string' && title.trim()) cardTitles.push(title.trim())
          })
        }
        if (Array.isArray(parsed.columns)) {
          parsed.columns.forEach((col: unknown) => {
            const name = (col as { name?: unknown })?.name
            if (typeof name === 'string' && name.trim()) columnNames.push(name.trim())
          })
        }

        if (parsed.title && !parsed.cards) {
          cardTitles.push(parsed.title.trim())
        }

        if (parsed.name && !parsed.columns) {
          columnNames.push(parsed.name.trim())
        }
      }
    } catch {
      // skip invalid JSON
    }
  }

  return { cardTitles, columnNames }
}
