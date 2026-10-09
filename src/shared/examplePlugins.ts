/** installed on request, never silently; together they cover the whole API */

interface ExamplePlugin {
  filename: string
  name: string
  description: string
  source: string
}

export const EXAMPLE_PLUGINS: ExamplePlugin[] = [
  {
    filename: 'daily-summary.js',
    name: 'Daily Summary',
    description: 'Writes a log entry each day listing what you finished, and notifies you.',
    source: `// Daily Summary: records what you finished, once per day.
//
// Shows: events, items.create, storage and notify. Every api call returns a
// promise, so await it.

module.exports = {
  metadata: {
    name: "Daily Summary",
    description: "Writes a log entry each day listing what you finished, and notifies you.",
    version: "2.0.0",
    permissions: ["read", "write", "notify"]
  },

  onLoad(api) {
    const today = () => new Date().toISOString().slice(0, 10)

    api.events.on('item:completed', async ({ item }) => {
      const day = today()
      // Storage is private to this plugin, so this key can't collide with
      // another plugin's or with an app setting. One key that starts over each
      // day, so it never grows past what a day holds.
      const record = await api.storage.get('today', { day, titles: [], summarised: false })
      if (record.day !== day) Object.assign(record, { day, titles: [], summarised: false })
      record.titles.push(item.title)

      // One summary per day: the guard is what stops this becoming a log entry
      // per finished card.
      const due = !record.summarised && record.titles.length >= 5
      if (due) record.summarised = true
      await api.storage.set('today', record)
      if (!due) return

      await api.items.create({
        context: item.context,
        type: 'log',
        title: 'Finished ' + record.titles.length + ' things today',
        body: record.titles.map(t => '- ' + t).join('\\n')
      })
      await api.notify('Nice run', 'You have finished ' + record.titles.length + ' things today.')
    })

    api.log('watching for finished work')
  }
}
`
  },

  {
    filename: 'auto-tagger.js',
    name: 'Auto Tagger',
    description: 'Flags newly created cards whose title suggests a bug, so nothing urgent is missed.',
    source: `// Auto Tagger: raises the priority of cards that look urgent.
//
// Shows: events, items.update and reading the payload.

const URGENT = [/\\bbug\\b/i, /\\bcrash\\b/i, /\\bbroken\\b/i, /\\bregression\\b/i, /\\bhotfix\\b/i]

module.exports = {
  metadata: {
    name: "Auto Tagger",
    description: "Raises the priority of new cards whose title reads as urgent.",
    version: "2.0.0",
    permissions: ["read", "write"]
  },

  onLoad(api) {
    api.events.on('item:created', async ({ item }) => {
      if (item.type !== 'card') return
      // Only ever raises. Lowering a priority someone set deliberately would be
      // the plugin overruling the user.
      if (item.priority >= 3) return
      if (!URGENT.some(pattern => pattern.test(item.title))) return

      await api.items.update(item.id, { priority: 3 })
      api.log('raised priority on', item.title)
    })
  }
}
`
  },

  {
    filename: 'standup-reminder.js',
    name: 'Standup Reminder',
    description: 'Reminds you once each weekday morning, listing what is still open.',
    source: `// Standup Reminder: a weekday nudge with your open count.
//
// Shows: workspaces, items.query, notify, storage and a plain interval.

module.exports = {
  metadata: {
    name: "Standup Reminder",
    description: "Reminds you each weekday morning, with a count of what is still open.",
    version: "2.0.0",
    permissions: ["read", "notify"]
  },

  onLoad(api) {
    const HOUR = 9

    const check = async () => {
      const now = new Date()
      const day = now.getDay()
      if (day === 0 || day === 6) return          // weekends off
      if (now.getHours() !== HOUR) return

      const today = now.toISOString().slice(0, 10)
      if (await api.storage.get('lastReminded', '') === today) return
      await api.storage.set('lastReminded', today)

      // Only the workspaces you picked when you turned it on.
      let open = 0
      for (const context of await api.workspaces()) {
        const tasks = await api.items.query({ context, type: 'task', limit: 200 })
        open += tasks.filter(t => t.status !== 'done' && t.status !== 'archived').length
      }

      await api.notify('Standup', open + ' task(s) still open.')
    }

    // Checked every ten minutes rather than scheduled to the minute: the app is
    // not always running at 9am, and a missed exact moment would mean no
    // reminder at all that day.
    const run = () => check().catch(err => api.log('check failed:', err))
    setInterval(run, 10 * 60 * 1000)
    run()
    api.log('standup reminder armed')
  }

  // No onUnload needed: turning a plugin off ends its sandbox, and its timers
  // with it.
}
`
  },

  {
    filename: 'finished-webhook.js',
    name: 'Finished Webhook',
    description: 'Posts the title of each card you finish to a webhook, such as a Slack channel.',
    source: `// Finished Webhook: tells a chat channel what you finished.
//
// Shows: api.fetch, the hosts list and settings. The webhook address is a
// secret, so it is a setting you fill in from Settings, never part of this file.
// Its host has to be listed in metadata.hosts, or the request is refused;
// listing a host is what asks you for the network when you turn it on.

module.exports = {
  metadata: {
    name: "Finished Webhook",
    description: "Posts the title of each card you finish to a webhook, such as a Slack channel.",
    version: "1.1.0",
    permissions: ["read"],
    hosts: ["hooks.slack.com"],
    settings: [
      {
        key: "webhook",
        label: "Webhook address",
        type: "secret",
        description: "The incoming webhook address from Slack. It has to start with https://hooks.slack.com/."
      }
    ]
  },

  onLoad(api) {
    api.events.on('item:completed', async ({ item }) => {
      // Read when needed, so a change in Settings applies straight away.
      const webhook = await api.settings.get('webhook')
      if (!webhook) {
        api.log('fill in the webhook address in the plugin settings first')
        return
      }
      const response = await api.fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Finished: ' + item.title })
      })
      if (response.status >= 300) api.log('the webhook answered', response.status, response.text)
    })
  }
}
`
  }
]

export function findExamplePlugin(filename: string): ExamplePlugin | null {
  return EXAMPLE_PLUGINS.find(p => p.filename === filename) ?? null
}
