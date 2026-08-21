import { z } from 'zod'
import type { AiStructuredKind } from '../shared/types'

// Runtime validation for structured AI output.
//
// The generator used to accept anything that parsed as an object, so a model
// answering `{}` or `{"cards": "soon"}` counted as success and the renderer
// silently produced nothing. These mirror the JSON schemas sent to the model
// and are what decides whether a generation actually worked.
//
// Deliberately lenient about extra keys and about types a small model tends to
// fumble, a priority arriving as "2" instead of 2 is a formatting slip, not a
// failed generation, so it is coerced rather than rejected.

/** Small models frequently emit numbers as strings. */
const looseInt = z.union([z.number(), z.string()]).transform(v => {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
})

const priority = looseInt.transform(n => Math.min(3, Math.max(1, n || 2)))

const tag = z.object({
  name: z.string().min(1),
  color: z.string().optional()
})

/** Tags are often emitted as bare strings; normalise both shapes. */
const tagList = z
  .array(z.union([tag, z.string().min(1).transform(name => ({ name }))]))
  .optional()
  .transform(list => list ?? [])

const boardCard = z.object({
  title: z.string().min(1),
  body: z.string().optional().transform(v => v ?? ''),
  status: z.string().optional().transform(v => v ?? ''),
  priority: priority.optional().transform(v => v ?? 2),
  due: z.string().optional(),
  tags: tagList
})

export const BoardResult = z.object({
  message: z.string().optional(),
  columns: z
    .array(
      z.object({
        name: z.string().min(1),
        wipLimit: z.union([looseInt, z.null()]).optional(),
        color: z.string().optional(),
        colorMode: z.string().optional()
      })
    )
    .optional(),
  cards: z.array(boardCard).min(1, 'no cards produced')
})

export const PlanResult = z.object({
  message: z.string().optional(),
  title: z.string().min(1),
  overview: z.string().optional().transform(v => v ?? ''),
  steps: z
    .array(
      z.object({
        title: z.string().min(1),
        details: z.string().optional().transform(v => v ?? ''),
        status: z.string().optional()
      })
    )
    .min(1, 'no steps produced')
})

export const DialogueResult = z.object({
  message: z.string().optional(),
  startNode: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        speaker: z.string().optional().transform(v => v ?? 'Narrator'),
        text: z.string().optional().transform(v => v ?? ''),
        choices: z
          .array(
            z.object({
              text: z.string().optional().transform(v => v ?? ''),
              target: z.string().optional().transform(v => v ?? 'end')
            })
          )
          .optional()
          .transform(v => v ?? [])
      })
    )
    .min(1, 'no dialogue nodes produced')
})

export const UpdateResult = z.object({
  message: z.string().optional(),
  operations: z
    .array(
      z.object({
        op: z.enum(['move', 'set_priority', 'retitle', 'update_body', 'archive', 'set_due_date']),
        target: z.string().min(1),
        toColumn: z.string().optional(),
        priority: priority.optional(),
        newTitle: z.string().optional(),
        newBody: z.string().optional(),
        due: z.string().optional()
      })
    )
    .min(1, 'no operations produced')
})

const VALIDATORS: Record<AiStructuredKind, z.ZodTypeAny> = {
  board: BoardResult,
  plan: PlanResult,
  dialogue: DialogueResult,
  update: UpdateResult
}

export interface ValidationOutcome {
  ok: boolean
  data?: unknown
  /** Human-readable problem list, fed back to the model on the repair attempt. */
  error?: string
}

export function validateStructured(kind: AiStructuredKind, data: unknown): ValidationOutcome {
  const result = VALIDATORS[kind].safeParse(data)
  if (result.success) return { ok: true, data: result.data }

  // Only the first few issues: a corrective prompt carrying thirty complaints
  // is worse for a small model than one carrying three.
  const issues = result.error.issues.slice(0, 4).map(i => {
    const path = i.path.length ? i.path.join('.') : '(root)'
    return `${path}: ${i.message}`
  })
  return { ok: false, error: issues.join('; ') }
}
