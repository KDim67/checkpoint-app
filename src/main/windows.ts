/** here, not index.ts, so IPC handlers don't import the entry point that imports them */

import type { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null
let quitting = false

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

/** null between one window closing and the next opening */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** no-op when there's no window */
export function sendToWindow(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, ...args)
}

/** lets close-to-tray tell a real quit from closing the window */
export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
