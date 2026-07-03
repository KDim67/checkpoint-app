import { z } from 'zod'

// Item Validation Schemas

export const CreateItemSchema = z.object({
  type: z.enum(['log', 'card', 'task']),
  context: z.string().min(1, 'Context slug cannot be empty'),
  title: z.string().default(''),
  body: z.string().default(''),
  status: z.string().default('open'),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  position: z.number().default(0),
  due_at: z.number().nullable().optional().default(null),
  metadata: z.string().default('{}')
})

export const UpdateItemSchema = CreateItemSchema.partial()

// Tag Validation Schemas

export const CreateTagSchema = z.object({
  name: z.string().min(1, 'Tag name cannot be empty'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color starting with #').default('#535e85')
})

// Relation Validation Schemas

export const RelationTypeSchema = z.enum(['blocks', 'relates_to', 'duplicates'])

// Bulk Operations Schemas

export const BulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)),
  patch: z.object({
    status: z.string().optional(),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
    context: z.string().optional()
  })
})

// Search Schemas

export const SearchQuerySchema = z.object({
  query: z.string(),
  context: z.string().optional(),
  type: z.enum(['log', 'card', 'task']).optional(),
  status: z.string().optional(),
  page: z.number().int().nonnegative().optional().default(0),
  pageSize: z.number().int().positive().optional().default(20)
})

export const TaskQueryParamsSchema = z.object({
  query: z.string().optional(),
  status: z.array(z.string()).optional(),
  priority: z.array(z.number()).optional(),
  tagIds: z.array(z.string()).optional(),
  dueStart: z.number().nullable().optional(),
  dueEnd: z.number().nullable().optional(),
  hasRelations: z.boolean().nullable().optional(),
  sortBy: z.string().optional(),
  sortDesc: z.boolean().optional(),
  page: z.number().int().positive().optional().default(1),
  pageSize: z.number().int().positive().optional().default(50),
  archivedOnly: z.boolean().optional()
})

export const CreateFocusSessionSchema = z.object({
  context: z.string().min(1, 'Context slug cannot be empty'),
  duration_ms: z.number().int().positive('Duration must be a positive integer'),
  notes: z.string().default(''),
  tasks_json: z.string().default('[]')
})


