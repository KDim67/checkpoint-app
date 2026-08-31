# Prompt: seed the Checkpoint board over MCP

Hand the block below to an agent that has the Checkpoint MCP server configured.
It sets up a workflow and files the current state of the project as cards.

---

You have access to Checkpoint, a local developer productivity app, through its
MCP server. Your task is to set up a Kanban board for the Checkpoint project
itself and populate it with the current state of the work.

## Step 1, Orient yourself first

Call `list_workspaces`, then `get_board` for the workspace named
`checkpoint-fixes-and-updates`. **Do not skip this.** You need the existing
column ids and card titles before you change anything, because:

- `configure_board` targets columns by name or id, and inventing one is the most
  common way these calls fail.
- Some cards below may already exist. Call `search_items` for a few of the
  titles before creating them. Do not create duplicates.

## Step 2, Configure the board

Use `configure_board` on `checkpoint-fixes-and-updates`. Aim for this shape,
adapting to whatever columns already exist rather than deleting good ones:

| Column | WIP limit | Definition of done |
|---|---|---|
| Backlog | none | Understood well enough to start. |
| In Progress | 3 | Being actively worked on right now. |
| In Review | 2 | Code written; needs verification or a second look. |
| Done | none | Merged, verified green, and committed. |

Set a `description` on each column (that is the definition-of-done field), and a
`wipLimit` where the table gives one. Give Done a green colour (`#22c55e`) and
In Review an amber one (`#f59e0b`).

Prefer `update_column` on existing columns over `delete_column` + `add_column`, 
deleting a column relocates its cards, and there is no reason to disturb them.

## Step 3, File the completed work

Create these as cards in **Done**, using `create_item` with
`type: "card"` and `status` set to the Done column's id. Keep the titles
verbatim so they stay searchable; put the detail in `body`.

1. **Restore the typecheck and lint gate**, `npm run lint` was broken (ESLint 9
   removed `--ext`) and there was no typecheck script, so 45 type errors and 295
   lint problems were invisible. Added `typecheck`, `lint`, `verify`, and a
   `prepackage` hook so a release cannot be cut from a red build.
2. **Fix the lucide `Map` import shadowing the global Map constructor**, 
   MapMakerView imported `Map` from lucide-react unaliased, so `new Map()`
   anywhere in that 3,800-line file constructed a React component instead.
3. **Fix two conditional-hook violations in the AI action blocks**, card and
   plan blocks called hooks after an early return, so hook count changed between
   renders whenever streaming output arrived late. Installed
   `eslint-plugin-react-hooks`, which had 7 disable comments referencing a rule
   that had never actually been active.
4. **Add React error boundaries**, there were none in 62,000 lines, so one
   render throw blanked the whole window.
5. **Lazy-load the right-hand panel**, AiStreamPanel, ChatMessage, GitPanel and
   ItemDetailPanel were eagerly bundled despite rendering only when the panel is
   open. Startup chunk went from 1,599,370 to 712,343 bytes.
6. **Encrypt AI provider credentials at rest**, OpenAI/Groq/OpenRouter keys were
   plaintext in SQLite, and therefore also in every gzip backup. Now encrypted
   via the OS keychain with `safeStorage`, migrated in place.
7. **Fix WebRTC message framing and backpressure**, the database payload was
   sent as a single message over a 256 KB SCTP ceiling, and file chunks were
   pushed with no regard for the 16 MB send queue. Measured before the fix: a
   5 MB message killed the channel, and 389 of 400 chunks arrived.
8. **Fix P2P pairing-code security**, the ntfy.sh signalling topic *was* the
   pairing code, publishing the very secret the payload encryption depended on.
   Topics are now hashed, PBKDF2 went from 1,000 to 600,000 iterations, and the
   code comes from a CSPRNG rather than `Math.random()`.
9. **Require confirmation before a collaboration session replaces a board**, 
   joining ran `DELETE FROM items WHERE context = ? AND type IN ('card','task')`
   with no warning, destroying the joiner's own board of the same name.
10. **Fix Settings accessibility**, no field label was associated with its
    control, and an inline `outline: none` was overriding the app's correct
    global focus ring on every settings input.
11. **Unify Kanban board configuration**, columns, background, swimlanes and
    archived columns lived under four keys with six separate writers. Now one
    versioned document per workspace, with a verified-lossless migration.
12. **Add Kanban customization**, collapsible columns, per-column sort,
    card-field toggles, and per-column definitions of done.
13. **Give the assistant a board-configuration vocabulary**, seven operations
    with one-click undo, so "cap Review at 3 and make Done green" is expressible.
14. **Build the MCP server**, 26 tools over authenticated loopback HTTP, with
    DNS-rebinding protection and its own Settings tab.

## Step 4, File the outstanding work

Create these in **Backlog**, with `priority` as given (3 = high, 2 = medium,
1 = low).

1. **Ship auto-update via a public releases repo** (priority 3), there is no
   updater and no `publish` config, so every installed copy is frozen at 1.0.0
   and any bug that reaches a user is permanent. Plan is a second, public repo
   holding only artifacts, so no GitHub token ships inside the app. Full steps
   are in `TODO.md`.
2. **Get a code-signing certificate** (priority 2), the installer is unsigned,
   so Windows SmartScreen warns on every install. This is a purchase, not a code
   change; electron-builder reads `CSC_LINK` and `CSC_KEY_PASSWORD` from the
   environment.
3. **Add a TURN relay for P2P sync** (priority 2), STUN only, so two peers
   behind symmetric NATs cannot connect at all. It now fails visibly rather than
   hanging, but the gap is real.
4. **Type the AI action-block payloads** (priority 2), `ChatMessage.tsx` holds
   83 of the codebase's ~226 `any`s and is also the file that turns model output
   into database writes. Zod schemas already exist in `aiSchemas.ts` but are only
   used to prompt, never to parse the response. Raise
   `@typescript-eslint/no-explicit-any` back to `error` afterwards.
5. **Connect a real MCP client and tune the tool descriptions** (priority 3), 
   all 26 tools are verified against a test harness, but no shipping client has
   connected. Tool descriptions are what a model reads to choose a tool, and they
   were written without ever watching one get chosen.
6. **Tighten the `configure_board` MCP schema** (priority 1), its `operations`
   argument is typed as a free-form record so the tolerant shared normalizer can
   handle small-model output. A capable client would do better with a schema it
   can actually see.
7. **Split `AiStreamPanel.tsx`** (priority 1), 3,655 lines. Follow the pattern
   already used to split GameDevView into per-tool hooks and panels.
8. **Add targeted tests** (priority 2), there is no test runner at all. Do not
   chase coverage; cover the code most likely to break silently:
   `shared/scoreEngine.ts`, `main/validation.ts`, the JSON-repair ladder in
   `aiActions.ts`, and the `user_version` database migrations.
9. **Remove Tailwind** (priority 1), fully wired into the build with zero
   utility classes used. Note `@tailwind base` is load-bearing: preflight is the
   only CSS reset, so it needs a substitute before removal.
10. **Fix cross-context delete broadcasting during collaboration** (priority 1), 
    `handleLocalMutation` filters by `detail.item.context`, but the `deleteItem`
    event carries only `{ type, id }`, so deletes from any workspace are
    forwarded to the peer.
11. **Fix the Fast Refresh warnings** (priority 1), `SettingsSection.tsx` and
    `AppearanceSettings.tsx` export non-component values alongside components, so
    edits to them force a full reload instead of a hot swap.
12. **Verify the unverified UI** (priority 2), collapsed Kanban columns, the
    Card Fields menu, and the MCP Settings tab all typecheck and build but have
    never been visually confirmed.

## Step 5, Report

Finish by calling `get_board` again and summarising what you created: the final
column layout, and how many cards landed in each column. If any operation was
skipped, say which and why, `configure_board` returns a `skipped` array, and
silently ignoring it is worse than reporting it.

## Rules

- **Never invent a column id or name.** Read the board first; copy values exactly.
- **Do not create duplicate cards.** Search before creating.
- **Prefer `archive_item` over deletion.** There is no `delete_item` tool by
  design; archiving is recoverable.
- If a tool returns a `skipped` list or an error string, surface it rather than
  retrying blindly.
