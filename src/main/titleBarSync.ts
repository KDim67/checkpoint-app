import { nativeTheme, BrowserWindow } from 'electron'

let appThemeGetter: (() => string) | null = null

/**
 * Paints the native window buttons on every window that has an overlay.
 *
 * Only the main window is built with one. The widget, the HUD and the tray
 * panel are frameless without it, and Electron throws for those by design, so
 * the failure is expected rather than something to report. The customizer used
 * to run its own copy of this loop and log that expected throw three times over
 * on every theme change.
 */
export function paintTitleBarOverlay(color: string, symbolColor: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return
    try {
      win.setTitleBarOverlay({ color, symbolColor })
    } catch {
      // This window was not made with an overlay. There is nothing to paint.
    }
  })
}

export function updateNativeTitleBarFromSettings(appTheme: string): void {
  let isDark = true
  if (appTheme === 'light') {
    isDark = false
  } else if (appTheme === 'system') {
    isDark = nativeTheme.shouldUseDarkColors
  }

  paintTitleBarOverlay(
    isDark ? '#0b0c10' : '#f8fafc',
    isDark ? '#f1f5f9' : '#0f172a'
  )
}

export function initTitleBarSync(getter: () => string): void {
  appThemeGetter = getter
  nativeTheme.on('updated', () => {
    if (appThemeGetter) {
      updateNativeTitleBarFromSettings(appThemeGetter())
    }
  })
}
