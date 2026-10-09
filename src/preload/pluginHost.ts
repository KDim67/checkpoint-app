/** the plugin window's whole bridge: JSON text out and in, nothing else; runs sandboxed, so it imports nothing */

// the sandbox hands this script its own require; aliased, since a bare call makes the build add an ES module shim it can't run
const sandboxRequire = require
const { contextBridge, ipcRenderer } = sandboxRequire('electron') as typeof import('electron')

// a plugin can't flood main with one giant message
const MAX_MESSAGE = 1_200_000

contextBridge.exposeInMainWorld('pluginHost', {
  send(message: unknown): void {
    let text: string | undefined
    try {
      text = JSON.stringify(message)
    } catch {
      return
    }
    if (typeof text !== 'string' || text.length > MAX_MESSAGE) return
    ipcRenderer.send('plugin-host:out', text)
  },
  onMessage(listener: (message: unknown) => void): void {
    ipcRenderer.on('plugin-host:in', (_event, text: string) => {
      try {
        listener(JSON.parse(text))
      } catch {
        // main only sends JSON; nothing to do with anything else
      }
    })
  }
})
