/** one shape for the panel, tray and close handler so "minimise to tray" can't disagree */

export interface StartupSettings {
  /** via electron's login-item API */
  openAtLogin: boolean
  /** hidden in the tray at login */
  startMinimised: boolean
  /** off by default, closing has always quit */
  closeToTray: boolean
  showTrayIcon: boolean
}

export const DEFAULT_STARTUP_SETTINGS: StartupSettings = {
  openAtLogin: false,
  startMinimised: false,
  closeToTray: false,
  showTrayIcon: true
}

/** and what each does, for every surface */
export const STARTUP_OPTIONS: {
  key: keyof StartupSettings
  label: string
  hint: string
  /** meaningless without a tray icon */
  needsTray: boolean
}[] = [
  { key: 'openAtLogin', label: 'Start with Windows', hint: 'Launch Checkpoint when you sign in.', needsTray: false },
  { key: 'startMinimised', label: 'Start hidden', hint: 'Go straight to the tray without opening a window.', needsTray: true },
  { key: 'closeToTray', label: 'Close to tray', hint: 'The window close button hides Checkpoint instead of quitting it.', needsTray: true },
  { key: 'showTrayIcon', label: 'Show tray icon', hint: 'The icon in the notification area. Turning it off disables the two above.', needsTray: false }
]

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

export function normalizeStartupSettings(raw: unknown): StartupSettings {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ...DEFAULT_STARTUP_SETTINGS }
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STARTUP_SETTINGS }

  const o = parsed as Record<string, unknown>
  const settings: StartupSettings = {
    openAtLogin: bool(o.openAtLogin, DEFAULT_STARTUP_SETTINGS.openAtLogin),
    startMinimised: bool(o.startMinimised, DEFAULT_STARTUP_SETTINGS.startMinimised),
    closeToTray: bool(o.closeToTray, DEFAULT_STARTUP_SETTINGS.closeToTray),
    showTrayIcon: bool(o.showTrayIcon, DEFAULT_STARTUP_SETTINGS.showTrayIcon)
  }

  // two combos would strand the user, corrected not stored
  return reconcile(settings)
}

/** without a tray icon neither hiding option is allowed, or only Task Manager gets it back */
export function reconcile(settings: StartupSettings): StartupSettings {
  if (settings.showTrayIcon) return settings
  return { ...settings, startMinimised: false, closeToTray: false }
}

/** written to the login item, read at startup */
export const MINIMISED_FLAG = '--start-minimised'

/** the flag decides, so opening by hand shows the window */
export function shouldStartHidden(argv: string[], settings: StartupSettings): boolean {
  return argv.includes(MINIMISED_FLAG) && settings.showTrayIcon
}

/** the tray needs creating or destroying */
export function trayVisibilityChanged(before: StartupSettings, after: StartupSettings): boolean {
  return before.showTrayIcon !== after.showTrayIcon
}
