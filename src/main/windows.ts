/**
 * The main window, and whether the app is on its way out.
 *
 * Held here rather than in index.ts because every IPC handler that needs to
 * reach the window would otherwise have to import the entry point, and the
 * entry point imports them.
 */

import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

/** Null between the window closing and the next one opening. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** The window as somewhere to send to, or null if there is nothing to send to. */
export function sendToWindow(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, ...args)
}

/**
 * Set once the app is quitting on purpose, so close-to-tray can tell that from
 * someone closing the window.
 */
export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
