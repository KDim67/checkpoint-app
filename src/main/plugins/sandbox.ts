/** a sandboxed renderer per plugin, never attached to a window: no node, no network, no permissions, its own process */

import { WebContentsView, session, type WebContents } from 'electron'
import { join } from 'path'
import { HOST_IN, HOST_PAGE_URL } from './hostPage'

export interface Sandbox {
  readonly contents: WebContents
  send(message: object): void
  /** working set of its renderer process, in KB, or null if it has none */
  memoryKb(metrics: Electron.ProcessMetric[]): number | null
  close(force: boolean): void
}

/** one session per plugin; chromium never shares a renderer process across sessions, so plugins can't share one */
const partitionFor = (filename: string): string => `plugin-${filename}`

function lockDown(ses: Electron.Session): void {
  // the host page is the only thing it may load, everything else is cancelled, websockets included
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== HOST_PAGE_URL }))
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', event => event.preventDefault())
  ses.setSpellCheckerEnabled(false)
}

export function openSandbox(
  filename: string,
  onGone: (reason: string, kind: 'crashed' | 'stopped') => void
): Sandbox {
  const ses = session.fromPartition(partitionFor(filename))
  lockDown(ses)

  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/pluginHost.mjs'),
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      // never shown, so the page would otherwise be throttled like a background tab
      backgroundThrottling: false,
      devTools: false,
      disableDialogs: true,
      safeDialogs: true
    }
  })
  const contents = view.webContents
  let closed = false

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-frame-navigate', event => event.preventDefault())
  contents.on('will-redirect', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())

  const gone = (reason: string, kind: 'crashed' | 'stopped'): void => {
    if (closed) return
    onGone(reason, kind)
  }
  contents.on('render-process-gone', (_event, details) => gone(`Its process ended (${details.reason}).`, 'crashed'))
  contents.on('unresponsive', () => gone('Checkpoint stopped it because it stopped responding.', 'stopped'))
  contents.on('preload-error', () => gone('Its sandbox failed to start.', 'crashed'))
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame) gone(`Its sandbox failed to load (${description || code}).`, 'crashed')
  })

  contents.loadURL(HOST_PAGE_URL).catch(() => {
    // did-fail-load reports it
  })

  return {
    contents,
    send(message: object): void {
      if (closed || contents.isDestroyed()) return
      contents.send(HOST_IN, JSON.stringify(message))
    },
    memoryKb(metrics: Electron.ProcessMetric[]): number | null {
      if (closed || contents.isDestroyed()) return null
      const pid = contents.getOSProcessId()
      const metric = metrics.find(m => m.pid === pid)
      return metric ? metric.memory.workingSetSize : null
    },
    close(force: boolean): void {
      if (closed) return
      closed = true
      if (!contents.isDestroyed()) {
        // a worker stuck in a loop won't let the page close politely
        if (force) contents.forcefullyCrashRenderer()
        contents.close()
      }
      // in memory only, but cleared so nothing it kept survives a restart either
      ses.clearStorageData().catch(() => {})
    }
  }
}
