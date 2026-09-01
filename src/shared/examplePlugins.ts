/**
 * Example plugins shipped with the app.
 *
 * They are **installed on request, never silently**. Writing executable files
 * into someone's plugins folder behind their back would sit badly next to the
 * warning on that same screen telling them to only enable code they trust, and
 * an example the user has read and chosen to enable teaches the API far better
 * than one that simply appeared.
 *
 * Each is a real, useful plugin rather than a hello-world: between them they
 * exercise every part of the API, so the folder doubles as the documentation.
 */

export interface ExamplePlugin {
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
    source: `// Daily Summary, records what you completed, once per day.
//
// Shows: events, items.create, storage (for the "once per day" guard) and notify.

module.exports = {
  metadata: {
    name: "Daily Summary",
    description: "Writes a log entry each day listing what you finished, and notifies you.",
    version: "1.0.0"
  },

  onLoad(api) {
    const today = () => new Date().toISOString().slice(0, 10)

    api.events.on('item:completed', ({ item }) => {
      const day = today()
      // Storage is scoped to this plugin, so this key cannot collide with
      // another plugin's or with an app setting.
      const done = api.storage.get('completed:' + day, [])
      done.push(item.title)
      api.storage.set('completed:' + day, done)

      // One summary per day: the guard is what stops this becoming a log entry
      // per completed card.
      if (api.storage.get('summarised', '') === day) return
      if (done.length < 5) return

      api.storage.set('summarised', day)
      api.items.create({
        type: 'log',
        context: item.context,
        title: 'Finished ' + done.length + ' things today',
        body: done.map(t => '- ' + t).join('\\n'),
        status: 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: '{}'
      })
      api.notify('Nice run', 'You have finished ' + done.length + ' things today.')
    })

    api.log('watching for completed work')
  },

  onUnload() {
    // Subscriptions made through api.events are torn down automatically, so
    // there is nothing to undo here.
  }
}
`
  },

  {
    filename: 'auto-tagger.js',
    name: 'Auto Tagger',
    description: 'Flags newly created cards whose title suggests a bug, so nothing urgent is missed.',
    source: `// Auto Tagger, raises the priority of cards that look urgent.
//
// Shows: events, items.update and reading the payload.

const URGENT = [/\\bbug\\b/i, /\\bcrash\\b/i, /\\bbroken\\b/i, /\\bregression\\b/i, /\\bhotfix\\b/i]

module.exports = {
  metadata: {
    name: "Auto Tagger",
    description: "Raises the priority of new cards whose title reads as urgent.",
    version: "1.0.0"
  },

  onLoad(api) {
    api.events.on('item:created', ({ item }) => {
      if (item.type !== 'card') return
      // Only ever raises. Lowering a priority someone set deliberately would be
      // the plugin overruling the user.
      if (item.priority >= 3) return
      if (!URGENT.some(pattern => pattern.test(item.title))) return

      api.items.update(item.id, { priority: 3 })
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
    source: `// Standup Reminder, a weekday nudge with your open count.
//
// Shows: items.query, notify, storage and a plain interval with cleanup.

module.exports = {
  metadata: {
    name: "Standup Reminder",
    description: "Reminds you each weekday morning, with a count of what is still open.",
    version: "1.0.0"
  },

  onLoad(api) {
    const HOUR = 9

    const check = () => {
      const now = new Date()
      const day = now.getDay()
      if (day === 0 || day === 6) return          // weekends off
      if (now.getHours() !== HOUR) return

      const today = now.toISOString().slice(0, 10)
      if (api.storage.get('lastReminded', '') === today) return
      api.storage.set('lastReminded', today)

      const open = api.items
        .query('default', 'task', 100)
        .filter(t => t.status !== 'done' && t.status !== 'archived')

      api.notify('Standup', open.length + ' task(s) still open.')
    }

    // Checked every ten minutes rather than scheduled to the minute: the app is
    // not always running at 9am, and a missed exact moment would mean no
    // reminder at all that day.
    this._timer = setInterval(check, 10 * 60 * 1000)
    check()
    api.log('standup reminder armed')
  },

  onUnload() {
    // A timer is not tracked by the host, this one has to clean up after
    // itself, or it would keep firing after the plugin is disabled.
    if (this._timer) clearInterval(this._timer)
  }
}
`
  }
]

export function findExamplePlugin(filename: string): ExamplePlugin | null {
  return EXAMPLE_PLUGINS.find(p => p.filename === filename) ?? null
}
