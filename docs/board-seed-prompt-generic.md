# Prompt: seed a Checkpoint board for any project, over MCP

Reusable version. Hand the block below to an agent that has **both** the
Checkpoint MCP server configured **and** access to the target project's
repository. Replace the two bracketed values at the top; everything else works
unchanged.

---

You have two things available: a codebase, and Checkpoint, a local developer
productivity app, through its MCP server. Your task is to survey the codebase
and set up a Kanban board in Checkpoint that reflects the project's real state:
what is finished, and what still needs doing.

**Project:** `[PATH TO THE REPOSITORY]`
**Checkpoint workspace:** `[WORKSPACE SLUG]`, if you are unsure, call
`list_workspaces` and ask which to use rather than guessing.

## Step 1, Survey the project before touching Checkpoint

Do not write anything until you can describe the project in your own words. Work
from evidence, not assumption:

- **Recent history.** `git log --oneline -40` and `git log --stat -10`. Commit
  subjects are the most reliable record of what was actually finished.
- **Stated intentions.** Any `TODO.md`, `ROADMAP.md`, `CHANGELOG.md`, issue
  templates, or `docs/` directory. Read them; do not just note they exist.
- **In-code markers.** Search for `TODO`, `FIXME`, `HACK`, `XXX`. Each is
  someone recording a debt against themselves.
- **Health signals.** Does the project have a test runner, and does it pass?
  Does it typecheck? Does it lint clean? A build script that has quietly stopped
  working is one of the most valuable cards you can file, and it will not appear
  in any TODO list.
- **Obvious gaps.** No tests at all, no CI, no error handling around a
  risky path, a dependency pinned to something ancient, secrets in plaintext.

Prefer a smaller number of specific, evidenced cards over a large number of
generic ones. "Add tests" is close to useless. "No test runner is configured;
cover the JSON-repair ladder in `aiActions.ts` and the database migrations
first" is actionable.

## Step 2, Read the board before changing it

Call `get_board` for the workspace. You need existing column ids and card titles
before you write, because:

- `configure_board` targets columns by name or id. Inventing one is the single
  most common way these calls fail.
- Cards may already exist. Call `search_items` for titles before creating them.
  Do not create duplicates.
- The board may already have real content. Leave it alone.

## Step 3, Configure the columns

Use `configure_board`. Unless the board already has a workflow that suits the
project, aim for:

| Column | WIP limit | Definition of done |
|---|---|---|
| Backlog | none | Understood well enough to start. |
| In Progress | 3 | Being actively worked on right now. |
| In Review | 2 | Code written; needs verification or a second look. |
| Done | none | Merged, verified, and committed. |

Set `description` on each column, that is the definition-of-done field, and it
is what makes a board self-explanatory later. Give Done a green colour
(`#22c55e`) and In Review amber (`#f59e0b`).

**Prefer `update_column` on existing columns over `delete_column` +
`add_column`.** Deleting relocates any cards in that column; there is no reason
to disturb them just to rename or recolour something.

## Step 4, File what is done

Create cards in **Done** with `create_item` (`type: "card"`, `status` set to the
Done column's id, `priority: 1`).

One card per meaningful piece of completed work. For each:

- **Title:** what was done, as a short imperative phrase. Keep it searchable.
- **Body:** what the problem actually was, and how you know it is fixed. Include
  concrete evidence where you have it, a measured before/after, a commit hash,
  a test count. A body that says "fixed the bug" is worse than no card.

Do not invent completions. If `git log` shows work you cannot verify, either
describe it as the commit describes it, or leave it out.

## Step 5, File what is outstanding

Create cards in **Backlog**, with `priority`: 3 = high, 2 = medium, 1 = low.

Prioritise by consequence, not by effort:

- **3**, users are affected now, or data or security is at risk.
- **2**, real cost, but contained; correctness and maintainability work.
- **1**, cleanup and polish worth doing when nearby.

Each body should say **why it matters** and **where to start**, the file, the
function, the specific gotcha. If something has a non-obvious trap, that trap is
the most valuable sentence in the card.

## Step 6, Report

Call `get_board` again and summarise: the final column layout, how many cards
landed in each, and anything you deliberately left out. If `configure_board`
returned a `skipped` array, say what was skipped and why, silently ignoring it
is worse than reporting it.

## Rules

- **Never invent a column id or name.** Read the board first; copy values exactly.
- **Never create duplicate cards.** Search before creating.
- **Never delete.** There is no `delete_item` tool by design. Use `archive_item`,
  which is recoverable.
- **Do not touch cards you did not create** unless explicitly asked.
- If a tool returns a `skipped` list or an error string, surface it rather than
  retrying blindly.
- Evidence over inference throughout. If you did not verify it, say so on the
  card rather than asserting it.

## Tools you will need

`list_workspaces`, `get_board`, `search_items`, `configure_board`,
`create_item`. The wider surface, notes, cheatsheets, git status, analytics,
tags, relations, is available if useful, but is not required for this task.
