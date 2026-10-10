/** Notion's databases have columns of their own, so which one means done and which is the date are worked out here */

/** where someone makes an internal integration and copies its secret */
export const NOTION_KEY_PAGE = 'https://www.notion.so/profile/integrations'

const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

export const isNotionId = (text: string): boolean => ID.test(text)

/** a card's link opens only a page on notion.so or notion.com */
export const opensNotion = (url: string): boolean => /^https:\/\/(www\.)?notion\.(so|com)\/\S+$/.test(url)

export interface NotionOption {
  id: string
  name: string
}

/** one column, as much of it as deciding needs */
export interface NotionProperty {
  id: string
  name: string
  type: string
  /** a select's or status's choices, in Notion's order */
  options?: NotionOption[]
  /** a status's groups: To-do, In progress and Complete, each holding option ids */
  groups?: { name: string; optionIds: string[] }[]
}

export type DoneColumn =
  | { kind: 'status'; id: string; name: string; complete: string[]; doneOption: string; openOption: string }
  | { kind: 'checkbox'; id: string; name: string }

export interface NotionColumns {
  title: string | null
  done: DoneColumn | null
  date: { id: string; name: string } | null
  tags: string | null
  priority: string | null
}

export interface ColumnChoice {
  done?: string | null
  date?: string | null
}

/** columns that can mean done: a status, or a checkbox */
export const doneCandidates = (schema: NotionProperty[]): NotionProperty[] =>
  schema.filter(p => (p.type === 'status' && (p.groups?.length ?? 0) > 0) || p.type === 'checkbox')

export const dateCandidates = (schema: NotionProperty[]): NotionProperty[] => schema.filter(p => p.type === 'date')

function doneColumn(p: NotionProperty): DoneColumn | null {
  if (p.type === 'checkbox') return { kind: 'checkbox', id: p.id, name: p.name }
  const groups = p.groups ?? []
  if (groups.length === 0) return null
  // Notion names its groups To-do, In progress and Complete; a renamed set falls back to the last group and the first
  const complete = groups.find(g => /complete/i.test(g.name)) ?? groups[groups.length - 1]
  const todo = groups.find(g => /to.?do/i.test(g.name)) ?? groups.find(g => g !== complete) ?? groups[0]
  const doneOption = complete.optionIds[0]
  const openOption = todo.optionIds[0]
  if (!doneOption || !openOption || doneOption === openOption) return null
  return { kind: 'status', id: p.id, name: p.name, complete: complete.optionIds, doneOption, openOption }
}

/** the chosen columns where they still exist, else the first that fits */
export function resolveColumns(schema: NotionProperty[], choice: ColumnChoice = {}): NotionColumns {
  const dones = doneCandidates(schema)
  const chosenDone = dones.find(p => p.id === choice.done)
  const done = [chosenDone, ...dones].reduce<DoneColumn | null>((found, p) => found ?? (p ? doneColumn(p) : null), null)
  const dates = dateCandidates(schema)
  const date = dates.find(p => p.id === choice.date) ?? dates[0]
  return {
    title: schema.find(p => p.type === 'title')?.id ?? null,
    done,
    date: date ? { id: date.id, name: date.name } : null,
    tags: schema.find(p => p.type === 'multi_select')?.id ?? null,
    priority: schema.find(p => (p.type === 'select' || p.type === 'status') && /priority/i.test(p.name))?.id ?? null
  }
}

export function notionPriority(name: unknown): 0 | 1 | 2 | 3 {
  const text = typeof name === 'string' ? name.toLowerCase() : ''
  if (/urgent|highest|high|critical|p1/.test(text)) return 3
  if (/medium|normal|p2/.test(text)) return 2
  if (/lowest|low|p3|p4/.test(text)) return 1
  return 0
}
