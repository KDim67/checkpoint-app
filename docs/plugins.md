# Writing Checkpoint plugins

A plugin is one JavaScript file in `.config/checkpoint/plugins/` (on Windows,
`%USERPROFILE%\.config\checkpoint\plugins\`). Checkpoint runs each plugin in its
own sandboxed process with no Node, no file access and no network of its own.
Everything it does goes through `api`, and Checkpoint checks every call against
what you approved when you turned the plugin on.

## A first plugin

Save this as `hello.js` in the plugins folder:

```js
/** @type {import('./checkpoint-plugin').Plugin} */
module.exports = {
  metadata: {
    name: "Hello",
    description: "Says well done when you finish something.",
    version: "1.0.0",
    permissions: ["read", "notify"]
  },

  onLoad(api) {
    api.events.on("item:completed", async ({ item }) => {
      await api.notify("Well done", item.title)
    })
  }
}
```

Then open Settings → Extensions, switch it on, pick the workspaces it can use
and approve. Plugins run while the Customization Engine is on.

The first line is optional. Checkpoint keeps `checkpoint-plugin.d.ts` in the
plugins folder, and with that line an editor such as VS Code autocompletes the
whole `api`.

## Metadata

Checkpoint reads `metadata` as text and never runs the file to find out what it
wants, so every value has to be written out literally: strings, numbers,
`true`, `false`, and lists of them. Anything computed is ignored.

| Field | What it is |
| --- | --- |
| `name` | Shown in Settings and in every error message |
| `description` | One line for Settings |
| `version` | Shown beside the name |
| `permissions` | Any of `"read"`, `"write"`, `"notify"` |
| `hosts` | The sites `api.fetch` may reach, such as `"hooks.slack.com"`. Listing a host is what asks for the network |
| `settings` | Fields you fill in from Settings; see [Settings](#settings) |

A permission or host Checkpoint doesn't recognise is shown to you as ignored
when you turn the plugin on.

## Permissions

| Permission | What it allows |
| --- | --- |
| `read` | See cards, tasks and log entries in the workspaces you picked, and receive events about them |
| `write` | Create and change them in those workspaces. Never delete, and never move one outside them |
| `notify` | Show notifications; quiet hours and the Plugins switch in Notifications still apply |
| `hosts` | HTTPS requests to exactly those hosts. Local and private addresses are refused even when listed, and so is a redirect to anywhere not listed |

Every plugin also gets its own small private storage, with no permission.

You approve the list as it stands. When the file is edited, Checkpoint restarts
the plugin; if it now asks for more than you approved, it stops and shows
**Needs your OK** until you review it. Asking for less needs nothing. Approvals
are per computer and never sync.

## The api

Every call returns a promise. A call the plugin isn't allowed to make rejects
with an error saying what to allow, so `try`/`catch` around `await` works as
usual.

### `api.workspaces()`

The workspaces you picked for this plugin, as slugs. A workspace you later
delete drops out on its own.

### `api.items`

| Call | Needs | Notes |
| --- | --- | --- |
| `get(id)` | read | `null` for a card outside your workspaces, exactly as for one that doesn't exist |
| `query({ context, type, limit })` | read | `type` is `"card"`, `"task"` or `"log"`; `limit` 1 to 200, default 50 |
| `create({ context, type, title, body, status, priority, due_at, position })` | write | For a card, a `status` that isn't a column means the first column |
| `update(id, changes)` | write | Any of `title`, `body`, `status`, `priority`, `due_at`, `position`, `context`. A card's `status` must be one of its board's columns |

`priority` is 0 none, 1 low, 2 medium, 3 high. `due_at` is unix milliseconds;
a date with no time of day is midnight UTC of that date.

### `api.events.on(name, handler)`

Needs `read`. Returns a function that stops the handler. Events only arrive
for items in the workspaces you picked.

| Event | Payload |
| --- | --- |
| `item:created` | `{ item }`, however it was made: in the app, by an agent or by a webhook |
| `item:completed` | `{ item }`, when it moves into a finished state |
| `due:reminded` | `{ itemId, title }`, when a due reminder fires |
| `focus:completed` | `{ context, durationMs }`, when a focus session ends |

A plugin that falls 200 events behind has the rest dropped, with a line in its
log.

### `api.notify(title, body)`

Needs `notify`. Resolves `true` if a notification was shown, `false` if quiet
hours or your notification settings held it back.

### `api.fetch(url, { method, headers, body })`

Needs the host in `hosts`. HTTPS only; `method` is `GET`, `HEAD`, `POST`,
`PUT`, `PATCH` or `DELETE`; `body` is a string of at most 64 KB. Resolves
`{ status, headers, text, url }`, where `url` is where it ended up after
redirects. Headers that speak for the connection, such as `Host`, are dropped,
and `Authorization` doesn't follow a redirect to another site.

### `api.storage.get(key, fallback)` and `api.storage.set(key, value)`

Private to this plugin. Values are JSON, at most 64 KB each and 1 MB in all.
`set(key, null)` removes a key.

### `api.settings.get(key)`

What you filled in for a field the plugin declares, its default, or `null`.
Read it when you need it and a change in Settings applies straight away.

### `api.log(...values)`

Shows under the plugin's **Log** button in Settings, along with its errors and
why Checkpoint stopped it if it did.

## Settings

A plugin that needs something from you, such as a webhook address or a token,
declares it instead of asking you to edit the file:

```js
settings: [
  { key: "webhook", label: "Webhook address", type: "secret",
    description: "From your chat app's incoming webhooks page." }
]
```

`type` is `"text"`, `"secret"`, `"number"` or `"boolean"`, and every field but
a secret can have a `default`. Each plugin's settings are kept on that computer
only and encrypted the way Checkpoint keeps its own keys, by the operating
system's credential protection where it has one. A saved secret is never shown
again, only replaced or cleared.

## Limits

Going over a limit rejects that one call; the plugin keeps running.

| What | Limit |
| --- | --- |
| Changes (`create`, `update`) | 60 a minute |
| Notifications | 10 an hour |
| Requests | 30 a minute, 15 seconds each, 64 KB sent, 1 MB read |
| Storage | 64 KB a value, 1 MB a plugin |
| Calls of any kind | 1000 every 10 seconds, 32 waiting at once |
| Log | 100 lines kept, 120 a minute |

## What isn't there

A plugin runs in a Web Worker inside its sandbox, so the usual browser and Node
globals are missing or refused:

- no `require`, `process`, `Buffer`, `window` or `document`;
- no `fetch`, `XMLHttpRequest`, `WebSocket` or `importScripts`; use `api.fetch`;
- no `eval` or `new Function`;
- no way to reach another plugin, whose sandbox is a separate process.

Timers (`setTimeout`, `setInterval`) work as normal.

## When it runs and stops

A plugin starts when the Customization Engine is on and you've approved it, and
restarts when its file changes. Checkpoint stops it when:

- you switch it off, or its file now asks for more than you approved;
- it doesn't finish `onLoad` within 10 seconds;
- it stops answering for 20 to 30 seconds, for example stuck in a loop;
- it uses more than 512 MB of memory;
- its process crashes.

Stopping ends the sandbox, timers and all, so `onUnload` is optional. If it's
there it gets about a second.

## Examples

Settings → Extensions installs four examples you can read before turning on:
Daily Summary (events, items, storage, notify), Auto Tagger (events, updates),
Standup Reminder (workspaces, queries, timers) and Finished Webhook (fetch,
hosts and a secret setting).
