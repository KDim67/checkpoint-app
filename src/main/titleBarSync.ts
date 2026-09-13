import { nativeTheme, BrowserWindow } from 'electron'

let appThemeGetter: (() => string) | null = null

/** only the main window has an overlay; electron throws for the rest by design, so don't report it */
export function paintTitleBarOverlay(color: string, symbolColor: string): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return
    try {
      win.setTitleBarOverlay({ color, symbolColor })
    } catch {
      // no overlay on this window, nothing to paint
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
