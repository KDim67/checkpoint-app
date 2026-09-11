/**
 * How Checkpoint behaves around the system tray and at login.
 *
 * Kept pure and shared so the settings panel, the tray itself and the window's
 * close handler all read the same shape. Three places that each have their own
 * idea of "minimise to tray" is how an app ends up quitting when you asked it to
 * hide.
 */

export interface StartupSettings {
  /** Start with Windows. Applied through Electron's login-item API, not a file. */
  openAtLogin: boolean
  /** When launched at login, start hidden in the tray rather than showing a window. */
  startMinimised: boolean
  /**
   * Closing the window hides it instead of quitting.
   *
   * Defaults to OFF. Closing has always quit this app, and silently changing
   * what the X button does would leave people thinking they had shut it down
   * while it kept running. It is opt-in, and the tray panel says so.
   */
  closeToTray: boolean
  /** Whether the tray icon is shown at all. */
  showTrayIcon: boolean
}

export const DEFAULT_STARTUP_SETTINGS: StartupSettings = {
  openAtLogin: false,
  startMinimised: false,
  closeToTray: false,
  showTrayIcon: true
}

/** The switches, and what each one actually does, for every surface that shows them. */
export const STARTUP_OPTIONS: {
  key: keyof StartupSettings
  label: string
  hint: string
  /** True when the option is meaningless without a tray icon to hide to. */
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

  // Two combinations would strand the user with no way back to the window, so
  // they are corrected rather than stored as asked.
  return reconcile(settings)
}

/**
 * Resolves settings that would otherwise hide the app with no way to reach it.
 *
 * Without a tray icon there is nothing to click, so neither starting minimised
 * nor closing to the tray can be allowed, either would leave a process running
 * with no window and no way to summon one back short of Task Manager.
 */
export function reconcile(settings: StartupSettings): StartupSettings {
  if (settings.showTrayIcon) return settings
  return { ...settings, startMinimised: false, closeToTray: false }
}

/** Written into the login item, read back at startup. Both ends need it. */
export const MINIMISED_FLAG = '--start-minimised'

/**
 * The flag decides, not the setting: opening the app by hand should show it.
 * Without a tray icon there is nothing to click, so it refuses to hide.
 */
export function shouldStartHidden(argv: string[], settings: StartupSettings): boolean {
  return argv.includes(MINIMISED_FLAG) && settings.showTrayIcon
}

/** True when a change to these settings needs the tray created or destroyed. */
export function trayVisibilityChanged(before: StartupSettings, after: StartupSettings): boolean {
  return before.showTrayIcon !== after.showTrayIcon
}
