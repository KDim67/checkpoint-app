# Feature gaps

What comparable productivity tools do that Checkpoint does not.

**Status: the roadmap this document used to hold is finished.** Every Tier 1,
Tier 2 and Tier 3 item shipped. What follows is the record of that, then the
short list of what genuinely remains.

Two things shape every judgement here. Checkpoint is **local-first and
single-user**, multiplayer, cloud and sharing features cost a great deal and
return little. And it has an **MCP server**, which almost nothing else in this
category does: features that give an agent more to work with land twice, once
for the user and once for anything driving the app from outside.

---

## A warning about this document

Three times now, an entry here has claimed something was missing that already
existed, a note graph view, card and note templates, and (in an earlier draft)
first-class subtasks. Each was written from memory instead of from a grep.

A later sweep probed roughly fifteen more candidate gaps and found **all but two
already implemented**: task dependencies, bulk operations, archived-item
recovery for both tasks and cards, card attachments with images, undo, empty
states in every primary view, lazy loading of every route, and rebindable
shortcuts.

**Check the codebase before adding anything to this list.** The app is far more
complete than its surface suggests, and a gap analysis written from impressions
will be wrong more often than right.

---

## Shipped

Everything below was once an entry on this list.

**Tier 1**, command palette (`shared/commandMatch.ts`), global search
(`shared/searchResults.ts`), recurring tasks (`shared/recurrence.ts` +
`main/recurrenceService.ts`).

**Tier 2**, due-date reminders (`main/dueReminders.ts`,
`shared/notificationPolicy.ts`), saved views (`shared/savedViews.ts`),
first-class subtasks (`shared/subtasks.ts`), export to markdown/CSV/JSON
(`shared/exportFormats.ts`).

**Tier 3**, natural-language capture (`shared/naturalDate.ts`), project
templates (`shared/projectTemplates.ts`).

**Already existed when first listed**, note graph view (`notes/GraphView.tsx`,
since given a full-size mode), note templates (`NOTE_TEMPLATES`), card templates
(the `isTemplate` metadata flag), and wiki-style backlinks.

---

## What actually remains

### First-run experience, the one real gap
**Verified absent:** no seeding, no tour, no tips, no keyboard-shortcut
discovery outside Settings.

A new install opens fourteen views and around thirty services with no
orientation. The command palette and global search, two of the best things in
the app, are undiscoverable unless you already know they exist. Shortcuts are
rebindable via `settings/HotkeyBinder.tsx`, but only if you think to look.

**Cheapest fix that closes most of it:** a first-run panel naming the palette
hotkey and offering a project template. The templates already exist, so this is
mostly wiring.

### Import from other tools
`db.importContext` reads Checkpoint's own export format only. Someone arriving
from Trello, Todoist or an Obsidian vault retypes everything.

Worth doing only if you are recruiting users off other tools. Trello's JSON
export is the easiest and highest-yield source.

---

## Deliberately not doing

- **Calendar view and two-way calendar sync.** Motion, Sunsama and Akiflow are
  built entirely around this and spend their engineering there. OAuth against
  Google or Microsoft, recurring-event expansion and timezone correctness are
  each larger than anything in the shipped list, and it drags a local-first app
  into a cloud dependency. Read-only iCal import later, if ever.
- **Mobile or web companion.** A second platform, not a feature.
- **Real-time multiplayer.** P2P sync already covers the actual need, one
  person, several machines. CRDTs are a different application.
- **Habit and streak tracking.** Recurring tasks cover most of the overlap.
- **Browser extension / web clipper.** The webhook gateway already accepts
  external input; point a bookmarklet at it.
- **Localisation.** A single-user local tool with one maintainer.
- **Custom fields, goals/OKRs, print-to-PDF.** Card metadata is already a free
  JSON column, export already covers getting data out, and neither of the others
  fits how this app is used.
- **Time estimates vs. actuals.** Considered and declined.

---

## Where Checkpoint sits

It already covers what each of these does in its own lane: **Obsidian** (notes,
backlinks, graph, plugins), **Linear** (command palette, saved views, WIP
limits), **Todoist** (recurring work, natural-language dates, filters),
**Trello** (board, templates, attachments), **ActivityWatch** (window tracking,
heatmaps), **Raycast** (quick-capture HUD).

Two things none of them have: an MCP server exposing 34 tools, and an assistant
with direct write access to the board.

The useful comparison is not what is missing. It is that this app spans six
categories that are normally six separate subscriptions, which is also why the
first-run problem above matters more than any individual feature would.
