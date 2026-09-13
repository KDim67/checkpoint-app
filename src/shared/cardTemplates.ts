/** pure: which column, where, and what history the copy mustn't inherit */

import type { CreateItemPayload, Item } from './types'

export function isTemplateCard(card: Item): boolean {
  try {
    const meta = JSON.parse(card.metadata || '{}')
    return meta.isTemplate === true
  } catch {
    return false
  }
}

/** content, tags and fields, no comments or activity, not a template; null without a column */
export function cardFromTemplate(
  template: Item,
  columns: ReadonlyArray<{ id: string }>,
  cards: Item[],
  context: string,
  now: number
): { payload: CreateItemPayload; tagIds: string[] } | null {
  const fallbackCol = columns[0]
  if (!fallbackCol) return null

  const colId = columns.some(c => c.id === template.status)
    ? template.status
    : fallbackCol.id

  const colCards = cards.filter(c => c.status === colId)
  const position = colCards.length > 0
    ? Math.max(...colCards.map(c => c.position)) + 1000.0
    : 1000.0

  let originalMeta = {}
  try {
    originalMeta = JSON.parse(template.metadata || '{}')
  } catch {
    // non-JSON metadata has nothing to carry
  }

  const cleanMeta = {
    ...originalMeta,
    isTemplate: false,
    comments: [],
    activities: [{ id: `act-${now}`, text: `Card created from template "${template.title}"`, createdAt: now }]
  }

  return {
    payload: {
      type: 'card',
      context,
      title: `${template.title} (Copy)`,
      body: template.body,
      status: colId,
      priority: template.priority,
      position,
      due_at: template.due_at,
      metadata: JSON.stringify(cleanMeta)
    },
    tagIds: template.tags?.map(t => t.id) || []
  }
}
