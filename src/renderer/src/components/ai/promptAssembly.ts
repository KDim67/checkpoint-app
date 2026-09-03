/**
 * Everything the assistant says to the model before the user's own words.
 *
 * These blocks were inline in runChatStream, which meant the prompt contract, 
 * which column ids are legal, which titles are forbidden, which of the seven
 * board operations exist, could only be checked by reading a 550-line function
 * and trusting it. They are pure functions here so that contract can be tested.
 *
 * Every string is moved verbatim. A reworded prompt is a behaviour change, and
 * this refactor is not the place for one.
 */

import { PALETTE_HINT } from './boardEnrich'
import { getSkillById } from './skills'
import type { ColumnConfig } from '../../../../shared/boardModel'
import type { Item } from '../../../../shared/types'
import type { IntentType, WorkspaceFileInfo } from './types'
import { detectSkill, estimateTokens } from './aiHelpers'

/** The house rules. Terse for small models, which lose the long form. */
export function buildBasePrompt(isSmallModel: boolean): string {
  const baseSystemPromptContent = isSmallModel
    ? `You are Checkpoint AI, a helpful project assistant with DIRECT WRITE ACCESS to the user's Kanban board. Anything you create is added to the board automatically.

WHEN CREATING CARDS:
- Give every card a clear title, a concrete one-line body, a priority (1=Low, 2=Medium, 3=High), and 1-3 short tags, each tag with a hex color.
- Reuse existing columns when they fit; only add a new column for a genuinely new stage.
- Never duplicate a card title that already exists on the board.
- ${PALETTE_HINT}

If asked to create, respond with a JSON batch block:
\`\`\`json
{
  "cards": [
    { "title": "Task Title", "body": "What to do / definition of done", "status": "Backlog", "priority": 2, "tags": [{ "name": "gameplay", "color": "#22c55e" }] }
  ]
}
\`\`\`
Otherwise, answer the user's question in friendly plain text.`
    : `You are the Checkpoint AI Assistant, a pair-programming partner and project coordinator built directly into a game developer's visual Kanban workspace. Everything you create is automatically added to the board; there is no copy-paste and no external tool (never mention Trello/Jira/Asana/Notion).

██ WHEN CREATING BOARD ITEMS ██
1. AUDIT first: read the live board state below (columns + card titles) before creating anything.
2. NO DUPLICATES: never create a card whose title matches or heavily overlaps an existing one.
3. REUSE COLUMNS: if the existing columns fit, place cards in them and DO NOT create columns. Only introduce a column for a genuinely new workflow stage.
4. QUALITY over quantity: propose essential, high-impact, well-scoped cards (3-6 by default, or the number requested), no filler.
5. BE CREATIVE & VISUAL: give every card a fitting priority (1-3) and 1-3 topical tags, each with a hex color. Give any new column a fitting hex color. ${PALETTE_HINT}
6. When creation is justified, just do it, don't ask permission or explain first.

██ WHEN CONVERSING ██
- For questions, explanations, audits, or advice: reply in friendly natural-language text. Do NOT emit JSON action blocks unless the user asked to create/add something.
- "Cards" and "Columns" are Checkpoint Kanban items (not playing cards).

██ FORMAT (only when creating) ██
- Batch (preferred for cards): \`\`\`json { "cards": [ { "title", "body", "status", "priority", "tags": [{ "name", "color" }] } ], "columns": [ { "name", "color", "colorMode": "header" } ] } \`\`\`, omit "columns" unless adding new stages.
- Implementation plan: \`\`\`json:create_plan { "title", "overview", "steps": [{ "title", "details", "status": "pending" }] } \`\`\`
- Branching dialogue: \`\`\`json:create_dialogue_tree { "startNode", "nodes": [{ "id", "speaker", "text", "choices": [{ "text", "target" }] }] } \`\`\`
- Valid JSON only: no trailing commas, no comments. priority is 1|2|3. colors are hex like "#a855f7". status is an existing column name or id.`
  return baseSystemPromptContent
}

/**
 * Models have no clock, so "Friday", "next week" and "overdue" mean nothing
 * without being pinned to a moment.
 */
export function buildDateBlock(now: Date): string {
  return `CURRENT DATE & TIME: ${now.toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (ISO date: ${now.toISOString().slice(0, 10)}). Resolve every relative date ("Friday", "next week", "overdue", "this sprint") against this moment. Cards may carry a deadline shown as (Due: …) in the board state below.`
}

/**
 * The live board, as the model sees it: legal column ids, what is in each
 * column, and the titles it must not duplicate.
 */
export function buildBoardState(
  validContext: string,
  colsList: ColumnConfig[],
  cardOnlyItems: Item[],
  allItems: Item[]
): string {
  // Per-column card summaries, ONLY type 'card' items: that is what
  // the Kanban board actually renders. Listing backlog tasks here made
  // the model (and the edit executor) target invisible items.
  const colSummaries: string[] = []
  for (const col of colsList) {
    const colCards = cardOnlyItems.filter(i => i.status === col.id || i.status.toLowerCase() === col.name.toLowerCase())
    let cardListText = ''
    if (colCards.length > 0) {
      cardListText = colCards.map(c => {
        const bodySnippet = c.body ? `, "${c.body.slice(0, 120).replace(/\n/g, ' ')}"` : ''
        const tagsText = c.tags && c.tags.length > 0 ? ` [Tags: ${c.tags.map((t: any) => t.name).join(', ')}]` : ''
        const dueText = c.due_at ? ` (Due: ${new Date(c.due_at).toISOString().slice(0, 10)})` : ''
        return `    • "${c.title}" (Priority: ${c.priority === 3 ? 'High' : c.priority === 2 ? 'Med' : 'Low'})${dueText}${tagsText}${bodySnippet}`
      }).join('\n')
    } else {
      cardListText = '    (empty)'
    }
    colSummaries.push(`Column "${col.name}" [ID: "${col.id}"]:\n${cardListText}`)
  }

  // VALID COLUMN IDs as a bullet list so the model can copy them exactly
  const validColIds = colsList.map(c => `  • "${c.id}" → "${c.name}"`).join('\n')

  // FORBIDDEN DUPLICATE TITLES as a bullet list (easier to match than CSV)
  const forbiddenTitles = allItems.length > 0
    ? allItems.map((i: any) => `  • ${i.title}`).join('\n')
    : '  (none yet)'

  const liveBoardStateText = [
    `CURRENT LIVE KANBAN BOARD STATE (Context: ${validContext})`,
    '',
    `VALID COLUMN IDs, use ONLY these exact strings in any "status" field:`,
    validColIds,
    '',
    `CARDS PER COLUMN:`,
    colSummaries.join('\n\n'),
    '',
    `FORBIDDEN DUPLICATE TITLES, NEVER create cards with these exact titles:`,
    forbiddenTitles,
    '',
    `BOARD RULES:`,
    `1. Use ONLY the column IDs from VALID COLUMN IDs above in any JSON "status" field. Never invent IDs.`,
    `2. NEVER create cards with titles from the FORBIDDEN list above.`,
    `3. JSON blocks ALWAYS create NEW items. Use plain text to reference or discuss existing items.`,
    `4. "Add more tasks" = generate entirely NEW tasks with completely different titles.`
  ].join('\n')
  return liveBoardStateText
}

/** Recalled memories, one per line, tagged with their category. */
export function buildMemoryBlock(
  memories: { category: string; memory_key: string; content: string }[]
): string {
  const memFormatted = memories.map(m => `- [${m.category.toUpperCase()}] ${m.memory_key}: ${m.content}`).join('\n')
  return `RECALLED PROJECT MEMORIES & KNOWN FACTS:\n${memFormatted}\n\nUse these persistent memories to maintain consistency with past decisions, user rules, and game lore.`
}

/**
 * The imported codebase, grouped by top-level folder and file type, structure
 * rather than a flat list of names, which a model cannot reason about.
 */
export function buildWorkspaceIndex(
  workspaceFolder: string,
  workspaceFiles: WorkspaceFileInfo[],
  workspaceFileCap: number
): string {
  const cappedFiles = workspaceFiles.slice(0, workspaceFileCap)

  // Group files by top-level folder
  const folderGroups: Record<string, typeof cappedFiles[0][]> = {}
  for (const f of cappedFiles) {
    const parts = f.relativePath.replace(/\\/g, '/').split('/')
    const topFolder = parts.length > 1 ? parts[0] : '(root)'
    if (!folderGroups[topFolder]) folderGroups[topFolder] = []
    folderGroups[topFolder].push(f)
  }

  // Summarize each folder: file count + extension buckets
  const folderSummaries = Object.entries(folderGroups)
    .map(([folder, files]) => {
      const extBuckets: Record<string, number> = {}
      for (const f of files) {
        const ext = f.extension || '(no ext)'
        extBuckets[ext] = (extBuckets[ext] || 0) + 1
      }
      const bucketStr = Object.entries(extBuckets)
        .sort((a, b) => b[1] - a[1])
        .map(([ext, count]) => `${ext}\u00d7${count}`)
        .join(', ')
      return `  \u{1F4C1} ${folder}/, ${files.length} file${files.length !== 1 ? 's' : ''} (${bucketStr})`
    })
    .join('\n')

  return `IMPORTED WORKSPACE CODEBASE INDEX:\nProject folder: ${workspaceFolder}\nTotal files: ${workspaceFiles.length}${workspaceFiles.length > 500 ? ' (capped at 500)' : ''}\n\nFile structure by folder:\n${folderSummaries}\n\nUse this structure to understand the project architecture. If you need a specific file's contents, ask the user to paste it or attach it as a cheatsheet.`
}

/**
 * Which skill to run under.
 *
 * A pinned skill wins. Otherwise one is recalled from the wording, and failing
 * that inferred from the intent, so asking for a dialogue tree gets the
 * narrative skill without the user having to pick it.
 */
export function resolveSkillId(
  activeSkillId: string | null,
  text: string,
  predictedIntent: IntentType
): string | null {
  let resolvedSkillId = activeSkillId || detectSkill(text)
  if (!resolvedSkillId) {
    if (predictedIntent === 'create_dialogue') resolvedSkillId = 'narrative_specialist'
    else if (predictedIntent === 'create_plan') resolvedSkillId = 'implementation_planner'
  }
  return resolvedSkillId
}

/** Which structured generator an intent maps to, or null to just stream. */
export function structuredKindFor(
  intent: IntentType
): 'board' | 'plan' | 'dialogue' | 'update' | 'config' | null {
  return intent === 'create_items' ? 'board' :
    intent === 'create_plan' ? 'plan' :
    intent === 'create_dialogue' ? 'dialogue' :
    intent === 'update_items' ? 'update' :
    intent === 'configure_board' ? 'config' : null
}

/** What the spinner says while the structured generator runs. */
export function waitingLabelFor(kind: 'board' | 'plan' | 'dialogue' | 'update' | 'config'): string {
  return kind === 'board' ? 'Composing board changes…' :
    kind === 'plan' ? 'Drafting a plan…' :
    kind === 'update' ? 'Applying board edits…' :
    kind === 'config' ? 'Adjusting board settings…' : 'Writing dialogue…'
}

/** The instruction handed to the structured generator for each kind. */
export function buildStructuredInstruction(
  structuredKind: 'board' | 'plan' | 'dialogue' | 'update' | 'config',
  wantsCols: boolean
): string {
  const columnGuidance = wantsCols
    ? `The user is asking about BOARD STRUCTURE, include a "columns" array of the workflow stages (each with a name and a hex color), and place the cards into those columns. Design a sensible pipeline (e.g. Backlog → In Progress → Review → Done) if none fits.`
    : `Reuse existing columns when they fit; only add columns for genuinely new stages.`
  const instruction = structuredKind === 'board'
    ? `Create the requested board items now. FIRST read the CURRENT LIVE KANBAN BOARD STATE above: do NOT create any card whose title matches or closely overlaps one already on the board (see the FORBIDDEN DUPLICATE TITLES list), only propose genuinely new, non-duplicate work. Give EVERY card a fitting priority (1-3) and 1-3 topical tags, each with a hex color. ${columnGuidance} ${PALETTE_HINT}`
    : structuredKind === 'plan'
    ? `Produce a concrete, specific implementation plan with actionable steps.`
    : structuredKind === 'update'
    ? `Apply the requested edits to EXISTING cards now. Read the CURRENT LIVE KANBAN BOARD STATE above. RULES: (1) "target" is ALWAYS a CARD TITLE copied exactly from CARDS PER COLUMN above, NEVER a column name. (2) The destination column goes ONLY in "toColumn" (a VALID COLUMN ID or name). (3) One operation per card: to move 2 cards, emit 2 move operations, each with one card title as target. (4) Do NOT use update_body unless the user explicitly asked to rewrite a description. (5) For deadlines use set_due_date with "due" as an ISO date YYYY-MM-DD, resolving relative dates against the CURRENT DATE above (empty string clears). (6) Only include operations the user actually asked for.`
    : `Produce a branching dialogue tree. Every choice.target must be an exact node id in the tree, or "end".`
  return instruction
}

/**
 * How much of the conversation can be carried, once the fixed costs of the
 * system prompt, the skill and the workspace index are paid for.
 */
export function historyBudgetFor(
  contextWindowTokens: number,
  resolvedSkillId: string | null,
  workspaceFolder: string | null,
  workspaceFiles: WorkspaceFileInfo[],
  workspaceFileCap: number
): number {
  const baseOverheadTokens = 900
  const skillTokens = resolvedSkillId ? estimateTokens(getSkillById(resolvedSkillId)?.systemPrompt || '') : 0
  const workspaceTokens = workspaceFolder ? estimateTokens(workspaceFiles.slice(0, workspaceFileCap).map(f => f.relativePath).join('\n')) : 0
  // 2000 held back for system docs and response safety.
  return contextWindowTokens - baseOverheadTokens - skillTokens - workspaceTokens - 2000
}

/** Reasoning style, tuned to what the model can actually do. */
export function buildReasoningInstruction(modelLower: string, isSmallModel: boolean): string {
  let reasoningInstruction = ''
  const isNativeThinking = modelLower.includes('r1') || modelLower.includes('think') || modelLower.includes('qwq')
  if (isNativeThinking) {
    reasoningInstruction = `You MUST write your internal chain-of-thought reasoning inside <think>...</think> tags. Keep your reasoning thorough, logical, and step-by-step. Do not output anything else inside the <think> tags.`
  } else if (isSmallModel) {
    reasoningInstruction = `Before answering, briefly consider:
1. Confirm the exact output format requested.
2. Cross-check for duplicate titles and valid column IDs.`
  } else {
    reasoningInstruction = `Analyze step-by-step:
1. What memory/context is relevant?
2. Which column IDs match the target state?
3. Prevent duplicate card titles.
Format your reasoning clearly before giving your final response.`
  }
  return reasoningInstruction
}

/**
 * The last thing in the prompt stack, and so the heaviest: exactly what shape
 * the answer must take for this intent.
 */
export function buildEnforcement(intent: IntentType): string {
  let enforcementContent = ''
  switch (intent) {
    case 'create_dialogue':
      enforcementContent = `⚡ NARRATIVE ACTION REQUIRED ⚡
Output a \`\`\`json:create_dialogue_tree block RIGHT NOW.
→ Every node must have: id (unique string), speaker, text, choices[].
→ Every choice.target MUST be an EXACT id of another node in this same tree, or the literal string "end".
→ CRITICAL: Cross-check every choice.target against your own node ids before outputting. A broken link is a hallucination.
→ Start with a node whose id matches the startNode field. Give each NPC a distinct voice.`
      break
    case 'create_plan':
      enforcementContent = `⚡ PLAN ACTION REQUIRED ⚡
Output a \`\`\`json:create_plan block RIGHT NOW.
→ Include: title, overview (2–4 sentences covering scope and risks), steps[].
→ Each step: { "title": "Step N: Short imperative verb phrase", "details": "Specific enough to start immediately", "status": "pending" }
→ After the plan block, ONE brief paragraph on tradeoffs. STOP. Do not ask about Kanban export or next steps.`
      break
    case 'create_items':
      enforcementContent = `⚡ ACTION REQUIRED, OUTPUT JSON BLOCKS NOW ⚡
→ Use ONLY the column IDs listed in VALID COLUMN IDs above in any "status" field. Never invent IDs.
→ Check FORBIDDEN DUPLICATE TITLES above, never repeat any of those exact titles.
→ Immediately output a \`\`\`json batch block with REAL, specific, unique content.
→ DO NOT explain first. DO NOT ask for permission. DO NOT produce vague placeholder titles. CREATE IT.`
      break
    case 'update_items':
      enforcementContent = `⚡ BOARD EDIT REQUIRED, OUTPUT AN update_board BLOCK NOW ⚡
Output a \`\`\`json:update_board block of this shape:
{ "operations": [ { "op": "move", "target": "Exact Existing Card Title", "toColumn": "Done" } ] }
→ op is one of: move | set_priority | retitle | update_body | archive.
→ "target" MUST be copied EXACTLY from the card titles in the CURRENT LIVE KANBAN BOARD STATE above. Never invent titles.
→ For "move", "toColumn" must be a VALID COLUMN ID or name from above.
→ Only the operations the user asked for. DO NOT create new cards.`
      break
    case 'configure_board':
      enforcementContent = `⚙️ BOARD SETTINGS CHANGE REQUIRED, OUTPUT A configure_board BLOCK NOW ⚙️
Output a \`\`\`json:configure_board block of this shape:
{ "operations": [ { "op": "update_column", "target": "Review", "wipLimit": 3, "color": "#f59e0b" } ] }
→ op is one of: add_column | update_column | delete_column | reorder_columns | set_background | set_swimlanes | set_card_display.
→ "target" MUST be a column name or id copied EXACTLY from the CURRENT LIVE KANBAN BOARD STATE above. Never invent one.
→ update_column accepts any of: name (to rename), wipLimit (number, or null for no limit), color (#rrggbb), colorMode ("header"|"full"), collapsed (bool), sort ("manual"|"priority"|"due"), description (the column's definition of done).
→ add_column needs "name"; optional wipLimit, color, description, position (0-based index).
→ reorder_columns takes "order": a list of ALL column names in the new order.
→ set_background takes "background": a #rrggbb colour or a preset name.
→ set_swimlanes takes "swimlanes": true|false. set_card_display takes "cardDisplay": { "priority": bool, "tags": bool, "due": bool, "bodyPreview": bool }.
→ These change board SETTINGS only. To move or edit CARDS, use an update_board block instead.
→ Only the operations the user asked for. Then ONE short sentence confirming what changed.`
      break
    default: // 'converse'
      enforcementContent = `💬 GENERAL CONVERSATION, DO NOT OUTPUT JSON BLOCKS 💬
→ DO NOT output any \`\`\`json structures, plan blocks, or dialogue trees.
→ Respond in natural, friendly plain text only.
→ Answer their question clearly, referencing the live board state or recalled memories where relevant.`
  }
  return enforcementContent
}
