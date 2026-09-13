/** nothing calls electron, the imports only sit beside IPC registration; records nothing */

export const ipcMain = {
  handle(): void {},
  on(): void {},
  removeHandler(): void {}
}

export const nativeTheme = {
  shouldUseDarkColors: true
}

export const app = {
  /** not packaged, so the updater stays off */
  isPackaged: false,
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

/** every image is empty, there is no chromium; notificationService then omits the icon */
export const nativeImage = {
  createFromPath(): { isEmpty(): boolean } {
    return { isEmpty: () => true }
  }
}

/** records raised notifications for assertions; cleared between tests */
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

export default { ipcMain, nativeTheme, app, BrowserWindow, shell, clipboard, Notification, nativeImage }
