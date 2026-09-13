/** plain descriptions written through normal paths, so templated equals hand-built */

import type { ColumnConfig } from './boardModel'
import type { ItemPriority } from './types'

interface TemplateColumn {
  name: string
  /** null or absent means no limit */
  wipLimit?: number | null
  /** definition of done, on hover */
  description?: string
}

interface TemplateCard {
  title: string
  body?: string
  /** a name; ids are derived so templates stay readable */
  column: string
  priority?: ItemPriority
  /** seeded unchecked */
  checklist?: string[]
}

export interface ProjectTemplate {
  id: string
  name: string
  /** one line under the name in the picker */
  description: string
  columns: TemplateColumn[]
  cards: TemplateCard[]
}

/** same derivation as normalizeColumn, so names map to the same ids */
export function templateColumnId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_')
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Four plain columns and nothing else.',
    columns: [
      { name: 'To Do' },
      { name: 'In Progress' },
      { name: 'In Review' },
      { name: 'Done' }
    ],
    cards: []
  },
  {
    id: 'software',
    name: 'Software Project',
    description: 'Backlog through review, with limits that keep work moving.',
    columns: [
      { name: 'Backlog', description: 'Anything captured but not committed to.' },
      { name: 'To Do', wipLimit: 8, description: 'Scoped and ready to start.' },
      { name: 'In Progress', wipLimit: 3, description: 'Being worked on right now.' },
      { name: 'In Review', wipLimit: 4, description: 'Open for review or awaiting QA.' },
      { name: 'Done', description: 'Merged and verified.' }
    ],
    cards: [
      {
        title: 'Set up the repository',
        column: 'To Do',
        priority: 3,
        body: 'Everything needed before the first real commit.',
        checklist: ['Initialise the repo', 'Add a README', 'Add a licence', 'Set up .gitignore']
      },
      {
        title: 'Get CI running',
        column: 'To Do',
        priority: 2,
        body: 'A build that fails loudly is worth more than a test suite nobody runs.',
        checklist: ['Build on push', 'Run the tests', 'Report status on pull requests']
      },
      {
        title: 'Write the first architecture note',
        column: 'Backlog',
        priority: 1,
        body: 'What this is, what it is not, and the decisions already made.'
      }
    ]
  },
  {
    id: 'game-jam',
    name: 'Game Jam',
    description: 'Discipline-split columns for a time-boxed build.',
    columns: [
      { name: 'Ideas', description: 'Unfiltered. Cut ruthlessly once the clock starts.' },
      { name: 'Design', wipLimit: 3, description: 'Mechanics and levels being figured out.' },
      { name: 'Art', wipLimit: 3, description: 'Sprites, models, audio.' },
      { name: 'Code', wipLimit: 3, description: 'Systems and gameplay.' },
      { name: 'Polish', wipLimit: 5, description: 'Only after the game is playable end to end.' },
      { name: 'Done', description: 'In the build.' }
    ],
    cards: [
      {
        title: 'Lock the core loop',
        column: 'Design',
        priority: 3,
        body: 'One sentence: what the player does, over and over. Nothing else starts until this is settled.'
      },
      {
        title: 'Get a playable grey-box build',
        column: 'Code',
        priority: 3,
        body: 'Ugly and complete beats beautiful and unfinished.',
        checklist: ['Player moves', 'Win condition', 'Lose condition', 'Restart']
      },
      {
        title: 'Decide the art direction',
        column: 'Art',
        priority: 2,
        body: 'Pick a constraint (palette, resolution, silhouette) and hold to it.'
      },
      {
        title: 'Reserve the last day for submission',
        column: 'Ideas',
        priority: 2,
        body: 'Build, itch page, screenshots, description. It always takes longer than it looks.'
      }
    ]
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage',
    description: 'Reported through verified, so nothing is closed on a guess.',
    columns: [
      { name: 'Reported', description: 'Raw reports, not yet reproduced.' },
      { name: 'Confirmed', description: 'Reproduced, with steps written down.' },
      { name: 'In Progress', wipLimit: 3, description: 'Someone is on it.' },
      { name: 'Needs Verification', wipLimit: 5, description: 'Fixed, awaiting a check against the original report.' },
      { name: 'Closed', description: 'Verified fixed, or deliberately declined.' }
    ],
    cards: [
      {
        title: 'Write the bug report template',
        column: 'Confirmed',
        priority: 2,
        body: 'Steps, expected, actual, version, environment. A report missing any of these costs an hour later.'
      },
      {
        title: 'Agree what severity means',
        column: 'Reported',
        priority: 1,
        body: 'Severity is only useful if two people reading the same bug pick the same level.'
      }
    ]
  },
  {
    id: 'writing',
    name: 'Writing',
    description: 'Idea to published, with editing kept separate from drafting.',
    columns: [
      { name: 'Ideas', description: 'Titles and angles, no commitment.' },
      { name: 'Outlining', wipLimit: 3, description: 'Structure agreed before prose starts.' },
      { name: 'Drafting', wipLimit: 2, description: 'Writing badly on purpose. No editing here.' },
      { name: 'Editing', wipLimit: 3, description: 'Cutting, tightening, fact-checking.' },
      { name: 'Published', description: 'Out in the world.' }
    ],
    cards: [
      {
        title: 'Decide who this is for',
        column: 'Outlining',
        priority: 3,
        body: 'One reader, named. Writing for everyone reads as writing for nobody.'
      },
      {
        title: 'Keep a swipe file',
        column: 'Ideas',
        priority: 1,
        body: 'Openings, structures and turns of phrase worth stealing from.'
      }
    ]
  },
  {
    id: 'client-work',
    name: 'Client Work',
    description: 'Enquiry to invoice, with the waiting-on-them stage made visible.',
    columns: [
      { name: 'Enquiry', description: 'Interest, not yet scoped.' },
      { name: 'Scoping', wipLimit: 3, description: 'Working out what it is and what it costs.' },
      { name: 'In Progress', wipLimit: 2, description: 'Agreed and underway.' },
      { name: 'Client Review', description: 'Waiting on them. Parked here, not counted as in progress.' },
      { name: 'Invoiced', description: 'Delivered and billed.' }
    ],
    cards: [
      {
        title: 'Write the scope before quoting',
        column: 'Scoping',
        priority: 3,
        body: 'What is included, what is not, and what a change costs.',
        checklist: ['Deliverables listed', 'Revisions capped', 'Payment terms agreed', 'Out of scope written down']
      },
      {
        title: 'Set up the invoice reminder',
        column: 'Enquiry',
        priority: 1,
        body: 'Invoices go out on delivery, not whenever it is next remembered.'
      }
    ]
  },
  {
    id: 'personal',
    name: 'Personal Goals',
    description: 'Horizon-based columns, so someday and this week stop competing.',
    columns: [
      { name: 'Someday', description: 'Wanted, but not now. Reviewed monthly.' },
      { name: 'This Month', wipLimit: 5, description: 'Committed to for this month.' },
      { name: 'This Week', wipLimit: 3, description: 'Committed to for this week.' },
      { name: 'Doing', wipLimit: 1, description: 'One thing at a time.' },
      { name: 'Done', description: 'Finished. Worth looking back at.' }
    ],
    cards: [
      {
        title: 'Set a weekly review time',
        column: 'This Week',
        priority: 2,
        body: 'Move things down a horizon, and be honest about what did not happen.'
      },
      {
        title: 'Pick one thing that matters this month',
        column: 'This Month',
        priority: 3,
        body: 'If everything is a priority, the list is just a wish.'
      }
    ]
  }
]

export const DEFAULT_TEMPLATE_ID = 'blank'

export function findProjectTemplate(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find(t => t.id === id) ?? null
}

/** as the board config stores them */
export function buildTemplateColumns(template: ProjectTemplate): ColumnConfig[] {
  return template.columns.map(col => ({
    id: templateColumnId(col.name),
    name: col.name,
    wipLimit: col.wipLimit ?? null,
    ...(col.description ? { description: col.description } : {})
  }))
}

interface TemplateCardDraft {
  title: string
  body: string
  /** already resolved */
  status: string
  priority: ItemPriority
  position: number
  metadata: string
}

/** spaced 1000 apart like the board; unknown columns fall back to the first */
export function buildTemplateCards(
  template: ProjectTemplate,
  idPrefix = 'tpl'
): TemplateCardDraft[] {
  const columns = buildTemplateColumns(template)
  if (columns.length === 0) return []

  const byName = new Map(columns.map(c => [c.name.toLowerCase(), c.id]))
  const perColumn = new Map<string, number>()

  return template.cards.map((card, index) => {
    const status = byName.get(card.column.trim().toLowerCase()) ?? columns[0].id
    const seen = perColumn.get(status) ?? 0
    perColumn.set(status, seen + 1)

    const checklist = (card.checklist ?? []).map((text, i) => ({
      id: `${idPrefix}-${index}-${i}`,
      text,
      done: false
    }))

    return {
      title: card.title,
      body: card.body ?? '',
      status,
      priority: card.priority ?? 0,
      position: (seen + 1) * 1000,
      metadata: JSON.stringify({
        isTemplate: false,
        checklist,
        comments: [],
        activities: []
      })
    }
  })
}

/** for the picker */
export function describeTemplate(template: ProjectTemplate): string {
  const cols = `${template.columns.length} column${template.columns.length === 1 ? '' : 's'}`
  if (template.cards.length === 0) return cols
  return `${cols} · ${template.cards.length} card${template.cards.length === 1 ? '' : 's'}`
}
