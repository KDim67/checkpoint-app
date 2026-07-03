import type OpenAI from 'openai'
import { createOpenAiClient, getAiConfig, humanizeAiError } from './aiService'
import type { AiStructuredParams, AiStructuredResult, AiStructuredKind } from '../shared/types'

// Reliable structured generation.
//
// Instead of hoping a model emits valid fenced JSON inside a free-text stream
// (which small local models cannot do), we force structured output through the
// strongest mechanism the endpoint supports, falling back gracefully:
//
//   1. tool calling            (forced single function w/ JSON-schema params)
//   2. response_format json_schema
//   3. response_format json_object  (+ schema described in the prompt)
//   4. plain text              (+ schema in prompt, robust extraction)
//
// The winning method is cached per (endpoint, model) so subsequent calls skip
// straight to what works. Every path returns a parsed object; shape validation
// and creative enrichment happen in the renderer.

type Method = 'tools' | 'json_schema' | 'json_object' | 'text'

const capabilityCache = new Map<string, Method>()

// JSON schemas (used both to constrain decoding and to describe the shape)

const BOARD_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'One or two friendly sentences summarizing what you created.' },
    columns: {
      type: 'array',
      description: 'ONLY brand-new workflow stages to create. Omit entirely if existing columns are sufficient.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          wipLimit: { type: ['integer', 'null'] },
          color: { type: 'string', description: 'hex color like #3b82f6' },
          colorMode: { type: 'string', enum: ['header', 'full', 'none'] }
        },
        required: ['name']
      }
    },
    cards: {
      type: 'array',
      description: 'The cards to create.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string', description: 'A concrete description / definition of done.' },
          status: { type: 'string', description: 'Target column name or id from the board state.' },
          priority: { type: 'integer', enum: [1, 2, 3], description: '1=Low, 2=Medium, 3=High' },
          due: { type: 'string', description: 'Optional deadline as ISO date YYYY-MM-DD (only when the user asked for one).' },
          tags: {
            type: 'array',
            description: '1-3 short topical labels, each with a hex color.',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, color: { type: 'string' } },
              required: ['name']
            }
          }
        },
        required: ['title', 'body', 'status', 'priority', 'tags']
      }
    }
  },
  required: ['message', 'cards']
} as const

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    title: { type: 'string' },
    overview: { type: 'string', description: '2-4 sentences: scope, goals, risks/unknowns.' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative verb phrase.' },
          details: { type: 'string', description: 'Specific enough to start immediately.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done'] }
        },
        required: ['title', 'details']
      }
    }
  },
  required: ['title', 'overview', 'steps']
} as const

const DIALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    startNode: { type: 'string', description: 'id of the first node.' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          speaker: { type: 'string' },
          text: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'player response label' },
                target: { type: 'string', description: 'EXACT id of another node, or "end"' }
              },
              required: ['text', 'target']
            }
          }
        },
        required: ['id', 'speaker', 'text', 'choices']
      }
    }
  },
  required: ['startNode', 'nodes']
} as const

const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'One friendly sentence summarizing the changes.' },
    operations: {
      type: 'array',
      description: 'Edits to apply to EXISTING cards on the board.',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['move', 'set_priority', 'retitle', 'update_body', 'archive', 'set_due_date'] },
          target: { type: 'string', description: 'EXACT title of an existing card from the live board state.' },
          toColumn: { type: 'string', description: 'For "move": destination column name or id from the board state.' },
          priority: { type: 'integer', enum: [1, 2, 3], description: 'For "set_priority": 1=Low, 2=Medium, 3=High.' },
          newTitle: { type: 'string', description: 'For "retitle": the new card title.' },
          newBody: { type: 'string', description: 'For "update_body": the new card description.' },
          due: { type: 'string', description: 'For "set_due_date": ISO date YYYY-MM-DD resolved against the CURRENT DATE in the context; empty string clears the due date.' }
        },
        required: ['op', 'target']
      }
    }
  },
  required: ['message', 'operations']
} as const

const SCHEMAS: Record<AiStructuredKind, object> = {
  board: BOARD_SCHEMA,
  plan: PLAN_SCHEMA,
  dialogue: DIALOGUE_SCHEMA,
  update: UPDATE_SCHEMA
}

const SCHEMA_HINTS: Record<AiStructuredKind, string> = {
  board: `Respond with ONLY a JSON object of this shape (no prose, no markdown fences):
{
  "message": "friendly one-line summary",
  "columns": [ { "name": "Stage", "wipLimit": null, "color": "#3b82f6", "colorMode": "header" } ],
  "cards": [ { "title": "...", "body": "...", "status": "<column name or id>", "priority": 2, "tags": [ { "name": "gameplay", "color": "#a855f7" } ] } ]
}
Rules: priority is 1|2|3. Omit "columns" (or use []) if the existing columns fit. Give EVERY card 1-3 tags with hex colors.`,
  plan: `Respond with ONLY a JSON object of this shape (no prose, no markdown fences):
{ "message": "...", "title": "...", "overview": "...", "steps": [ { "title": "Step 1: ...", "details": "...", "status": "pending" } ] }`,
  dialogue: `Respond with ONLY a JSON object of this shape (no prose, no markdown fences):
{ "message": "...", "startNode": "start", "nodes": [ { "id": "start", "speaker": "Elder", "text": "...", "choices": [ { "text": "...", "target": "node_2" } ] } ] }
Every choice.target MUST be an exact id of another node, or "end".`,
  update: `Respond with ONLY a JSON object of this shape (no prose, no markdown fences):
{ "message": "...", "operations": [ { "op": "move", "target": "Exact Card Title", "toColumn": "Done" }, { "op": "set_priority", "target": "...", "priority": 3 }, { "op": "archive", "target": "..." } ] }
Rules: op is move|set_priority|retitle|update_body|archive|set_due_date. "target" is ALWAYS a CARD TITLE copied exactly from the board state, NEVER a column name (columns go only in "toColumn"). For set_due_date, "due" is an ISO date YYYY-MM-DD (resolve "Friday"/"next week" against the CURRENT DATE given in context; empty string clears). One operation per card. Never invent titles.`
}

const FN_DESCRIPTIONS: Record<AiStructuredKind, string> = {
  board: 'Create Kanban columns and/or cards on the board.',
  plan: 'Produce a structured implementation plan.',
  dialogue: 'Produce a branching dialogue / quest tree.',
  update: 'Edit existing Kanban cards: move between columns, change priority, retitle, rewrite body, or archive.'
}

// Helpers

function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim()
}

function repairJson(s: string): string {
  return s
    .replace(/(["\d\]}])\s*[\r\n]+\s*(?=")/g, '$1,') // missing commas between lines
    .replace(/,\s*([\]}])/g, '$1')                    // trailing commas
    .replace(/\/\/.*$/gm, '')                          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')                  // block comments
}

/** Robustly pull a JSON object/array out of arbitrary model text. */
function extractJson(raw: string): unknown {
  if (!raw) return null
  let text = stripThink(raw)
  const fence = text.match(/```(?:json[^\n]*)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  const tryParse = (candidate: string): unknown => {
    try { return JSON.parse(candidate) } catch { /* noop */ }
    try { return JSON.parse(repairJson(candidate)) } catch { /* noop */ }
    return undefined
  }

  const direct = tryParse(text)
  if (direct !== undefined) return direct

  // Fall back to the outermost brace/bracket span
  const spans: string[] = []
  const fo = text.indexOf('{'), lo = text.lastIndexOf('}')
  if (fo !== -1 && lo > fo) spans.push(text.slice(fo, lo + 1))
  const fa = text.indexOf('['), la = text.lastIndexOf(']')
  if (fa !== -1 && la > fa) spans.push(text.slice(fa, la + 1))
  for (const span of spans) {
    const parsed = tryParse(span)
    if (parsed !== undefined) return parsed
  }
  return null
}

/** Heuristic: does this error mean "the endpoint doesn't support this method"? */
function looksUnsupported(err: unknown): boolean {
  const e = err as { status?: number; message?: string }
  const status = e?.status
  const msg = String(e?.message || err || '').toLowerCase()
  if (status === 400 || status === 404 || status === 422 || status === 501) return true
  return (
    msg.includes('tool') ||
    msg.includes('function call') ||
    msg.includes('response_format') ||
    msg.includes('json_schema') ||
    msg.includes('not support') ||
    msg.includes('does not support') ||
    msg.includes('unsupported') ||
    msg.includes('unknown parameter')
  )
}

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; status?: number }
  return (
    e?.name === 'AbortError' ||
    e?.status === 499 ||
    String(e?.message || '').toLowerCase().includes('abort')
  )
}

/**
 * Errors that won't change across methods, bail out immediately and let the
 * caller fall back to streaming (which surfaces a humanized message). Auth
 * failures and 404s (missing model / wrong URL) affect every method equally.
 */
function isFatalError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  return status === 401 || status === 403 || status === 404
}

// Per-method attempts (each returns a parsed object, or null on parse fail)

async function attemptTools(
  client: OpenAI, model: string, messages: OpenAI.Chat.ChatCompletionMessageParam[],
  kind: AiStructuredKind, temperature: number, signal: AbortSignal
): Promise<unknown> {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: 3072,
    tools: [{
      type: 'function',
      function: {
        name: `emit_${kind}`,
        description: FN_DESCRIPTIONS[kind],
        parameters: SCHEMAS[kind] as Record<string, unknown>
      }
    }],
    tool_choice: { type: 'function', function: { name: `emit_${kind}` } }
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming

  const resp = await client.chat.completions.create(body, { signal }) as OpenAI.Chat.ChatCompletion

  const call = resp.choices[0]?.message?.tool_calls?.[0]
  if (call && call.type === 'function' && call.function?.arguments) {
    return extractJson(call.function.arguments)
  }
  // Some endpoints answer a forced tool call in content instead
  return extractJson(resp.choices[0]?.message?.content || '')
}

async function attemptJsonSchema(
  client: OpenAI, model: string, messages: OpenAI.Chat.ChatCompletionMessageParam[],
  kind: AiStructuredKind, temperature: number, signal: AbortSignal
): Promise<unknown> {
  const resp = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: 3072,
    response_format: {
      type: 'json_schema',
      json_schema: { name: `${kind}_result`, schema: SCHEMAS[kind] as Record<string, unknown> }
    }
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal }) as OpenAI.Chat.ChatCompletion

  return extractJson(resp.choices[0]?.message?.content || '')
}

async function attemptJsonObject(
  client: OpenAI, model: string, messages: OpenAI.Chat.ChatCompletionMessageParam[],
  kind: AiStructuredKind, temperature: number, signal: AbortSignal
): Promise<unknown> {
  const withHint: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    { role: 'system', content: SCHEMA_HINTS[kind] }
  ]
  const resp = await client.chat.completions.create({
    model,
    messages: withHint,
    temperature,
    max_tokens: 3072,
    response_format: { type: 'json_object' }
  }, { signal }) as OpenAI.Chat.ChatCompletion

  return extractJson(resp.choices[0]?.message?.content || '')
}

async function attemptText(
  client: OpenAI, model: string, messages: OpenAI.Chat.ChatCompletionMessageParam[],
  kind: AiStructuredKind, temperature: number, signal: AbortSignal
): Promise<unknown> {
  const withHint: OpenAI.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    { role: 'system', content: SCHEMA_HINTS[kind] }
  ]
  const resp = await client.chat.completions.create({
    model,
    messages: withHint,
    temperature,
    max_tokens: 3072
  }, { signal }) as OpenAI.Chat.ChatCompletion

  return extractJson(resp.choices[0]?.message?.content || '')
}

const ATTEMPTS: Record<Method, typeof attemptTools> = {
  tools: attemptTools,
  json_schema: attemptJsonSchema,
  json_object: attemptJsonObject,
  text: attemptText
}

const DEFAULT_ORDER: Method[] = ['tools', 'json_schema', 'json_object', 'text']

/**
 * Generates a structured result for the given kind, using the strongest method
 * the endpoint supports. Returns the parsed object plus which method worked.
 */
export async function generateStructured(
  params: AiStructuredParams,
  signal: AbortSignal
): Promise<AiStructuredResult> {
  const { kind, model, messages, temperature } = params
  const { client } = await createOpenAiClient()
  const { baseURL } = getAiConfig()
  const cacheKey = `${baseURL}::${model}`
  const temp = typeof temperature === 'number' ? temperature : 0.5

  // Prefer the previously-successful method for this endpoint/model.
  const cached = capabilityCache.get(cacheKey)
  const order: Method[] = cached
    ? [cached, ...DEFAULT_ORDER.filter(m => m !== cached)]
    : DEFAULT_ORDER

  let lastError: string | undefined
  for (const method of order) {
    try {
      const data = await ATTEMPTS[method](
        client, model, messages as OpenAI.Chat.ChatCompletionMessageParam[], kind, temp, signal
      )
      if (data && typeof data === 'object') {
        capabilityCache.set(cacheKey, method)
        return { ok: true, data, method }
      }
      // Parsed nothing usable, try the next method.
      lastError = `Model returned no usable ${kind} JSON via ${method}.`
    } catch (err) {
      if (isAbortError(err)) return { ok: false, error: 'aborted' }
      lastError = humanizeAiError(err, { model, baseURL })
      // Auth / not-found errors won't change across methods, stop and fall back.
      if (isFatalError(err)) break
      if (!looksUnsupported(err)) {
        // A genuine error (network, bad model). Keep trying the remaining methods
        // (a different one may work), remembering the message for diagnostics.
        continue
      }
    }
  }

  return { ok: false, error: lastError || 'Structured generation failed.' }
}
