/**
 * Stand-in for the `electron` module.
 *
 * Nothing under test calls into Electron; the imports exist only because
 * src/main modules sit next to IPC registration in the same files. These
 * members are the ones reached at import time or by `registerDbHandlers`,
 * and they record nothing, a test that genuinely needed Electron behaviour
 * would be testing the wrong layer.
 */

export const ipcMain = {
  handle(): void {},
  on(): void {},
  removeHandler(): void {}
}

export const nativeTheme = {
  shouldUseDarkColors: true
}

export const app = {
  getPath(name: string): string {
    return `/tmp/checkpoint-test/${name}`
  },
  getName(): string {
    return 'checkpoint-test'
  },
  getVersion(): string {
    return '0.0.0-test'
  }
}

/**
 * Records what was raised instead of showing anything, so a test can assert on
 * the notifications a sweep produced. `shown` is cleared between tests.
 */
export const shown: { title: string; body: string }[] = []

export class Notification {
  private options: { title: string; body: string }
  static isSupported(): boolean {
    return true
  }
  constructor(options: { title: string; body: string }) {
    this.options = options
  }
  on(): void {}
  show(): void {
    shown.push({ title: this.options.title, body: this.options.body })
  }
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return []
  }
}

export const shell = {
  openExternal(): Promise<void> {
    return Promise.resolve()
  }
}

export const clipboard = {
  readText(): string {
    return ''
  },
  writeText(): void {}
}

export default { ipcMain, nativeTheme, app, BrowserWindow, shell, clipboard, Notification }
