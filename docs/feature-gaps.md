# Feature gaps

What comparable productivity tools do that Checkpoint does not, ranked by
impact-to-effort for *this* app specifically.

Two things shape every judgement below. Checkpoint is **local-first and
single-user**, so multiplayer, cloud, and sharing features cost a great deal
and return little. And it has an **MCP server**, which almost nothing else in
this category does: features that give the agent more to work with compound,
because they land twice, once for the user, once for anything driving the app
from outside.

Each entry was checked against the codebase before being listed. Notes already
have backlinks (`NotesView.tsx:356`), so wiki-linking is not a gap; subtasks
exist only as markdown checkboxes appended to a task body
(`TaskDetailDrawer.tsx:56`), so they are a partial.

---

## Tier 1, do these first

### Command palette
**Who does it:** Linear, Raycast, Notion, Obsidian, VS Code, at this point it is
table stakes for anything keyboard-driven.
**Gap:** absent. Global hotkeys exist (`registerAppShortcuts`, `index.ts:82`) but
they are fixed single-purpose bindings; there is no way to reach an arbitrary
action by name.
**Why it matters here:** Checkpoint has fourteen views and roughly thirty
services. The surface has outgrown its navigation. This is also the single
cheapest way to make the app feel fast, and it is the feature users of Linear
and Raycast miss most immediately when it is absent.
**Where:** a new overlay component plus an action registry the existing views
register into. The MCP tool list is very nearly the same catalogue of verbs, so
the registry can be shared.
**Effort:** medium, the registry is the work, not the UI.

### Global search
**Who does it:** everything. Obsidian, Notion, Linear.
**Gap:** absent as a unified surface. The pieces are all there, `search_items`,
`search_notes`, `search_cheatsheets`, `search_memories` are already MCP tools,
and FTS5 backs them, but nothing in the UI queries across all of them at once.
**Why it matters here:** the data is already indexed and the queries already
exist. This is mostly assembly, and it turns four siloed searches into the thing
users actually want.
**Where:** one view over the existing FTS-backed services; pairs naturally with
the command palette.
**Effort:** small, given the indexes exist. Note the FTS backfill that migration
6 just added is what makes results trustworthy for older rows.

### Recurring tasks
**Who does it:** Todoist, TickTick, Things, OmniFocus, the defining feature of
the entire category.
**Gap:** fully absent. No recurrence, rrule, or repeat field anywhere.
**Why it matters here:** standups, weekly reviews, backups, releases. A tool
built around a work log is exactly where repeating work lives, and right now
every recurring obligation has to be re-typed.
**Where:** a recurrence field on `items`, plus a materialiser that runs at
startup next to `initializeBackupScheduler`. The scheduler pattern already
exists and can be copied.
**Effort:** medium. The trap is materialisation strategy, generate instances
lazily on read, not eagerly, or the table grows without bound.

---

## Tier 2, worth doing

### Due-date reminders
**Gap:** partial. `due_at` is stored and displayed, and the app already raises
OS notifications (`FocusTimerEngine.tsx:122`, `webhookGateway.ts:127`), but
nothing ever fires on a due date. The field is decorative.
**Why:** the two halves already exist and have never been connected. Small work,
and it closes a promise the UI currently makes and does not keep.
**Effort:** small.

### Saved views / smart lists
**Who does it:** Linear (views), Todoist (filters), Notion (database views).
**Gap:** absent.
**Why:** "everything overdue", "high priority across all workspaces", "untagged".
Checkpoint already has multiple workspaces, tags, priorities and statuses, the
filter dimensions exist, there is just no way to name a combination and return
to it. Worth more here than elsewhere because an MCP client could then ask for a
saved view by name instead of restating the query.
**Effort:** small, persist a filter object, apply it on read.

### First-class subtasks
**Gap:** partial, as noted, markdown checkboxes in the body only.
**Why:** checkbox subtasks cannot be counted, filtered, rolled up into progress,
or handed to the agent as separate work. `relations` and `link_items` already
model item-to-item edges, so the data layer is largely present.
**Effort:** medium, mostly UI.

### Export
**Who does it:** all of them, usually as a trust signal rather than a feature.
**Gap:** absent, no markdown, CSV, JSON, or PDF export path exists.
**Why:** this ships to real users, and a local-first tool with no way to get data
back out is asking for a leap of faith it has not earned. Cheap insurance.
**Effort:** small.

---

## Tier 3, plausible, not urgent

- **Natural-language capture** ("fix auth bug tomorrow 3pm #backend"). Fits the
  HUD quick-capture flow well. But there is already a local LLM in the app, so
  this may be better done through it than with a date-parsing library.
- **Time estimates vs. actuals.** Focus sessions already record real time spent;
  adding an estimate turns that into calibration data. Small, and analytics has
  somewhere to put it.
- **Note graph view.** Backlinks exist, so the edges are already computed. This
  is visualisation only, genuinely nice, genuinely optional.
- **Templates** for cards, notes, and projects. Modest win on its own; better
  once recurring tasks exist, since the two share machinery.

---

## Skip

- **Calendar view and two-way calendar sync.** Motion, Sunsama and Akiflow are
  built entirely around this, and it is where they spend their engineering.
  OAuth against Google or Microsoft, recurring-event expansion, and timezone
  correctness are each larger than anything in Tier 1. It also drags a
  local-first app into cloud dependency. Read-only iCal import later, if ever.
- **Mobile or web companion.** A second platform, not a feature.
- **Real-time multiplayer.** P2P sync already covers the actual need, one
  person, several machines. CRDTs are a different application.
- **Habit and streak tracking.** Genuinely popular, genuinely a different app.
  Recurring tasks cover most of the overlap.
- **Browser extension / web clipper.** The webhook gateway already accepts
  external input; point a bookmarklet at it rather than shipping and maintaining
  an extension.

---

## The one to start with

**Command palette**, then **global search** immediately after, they share the
action registry, and the second is mostly assembly once the first exists. Both
are pure additions with no migration risk, which matters given how much of the
recent work has been repairing settings and schema drift.

**Recurring tasks** is the highest-value single feature on this list, but it
touches the schema and wants the calmest possible moment to land.
