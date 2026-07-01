import { nativeTheme, BrowserWindow } from 'electron'

let appThemeGetter: (() => string) | null = null

export function updateNativeTitleBarFromSettings(appTheme: string): void {
  let isDark = true
  if (appTheme === 'light') {
    isDark = false
  } else if (appTheme === 'system') {
    isDark = nativeTheme.shouldUseDarkColors
  }

  const color = isDark ? '#0b0c10' : '#f8fafc'
  const symbolColor = isDark ? '#f1f5f9' : '#0f172a'

  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed() && typeof win.setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay({ color, symbolColor })
      } catch {
        // Ignored if window does not have native titleBarOverlay enabled
      }
    }
  })
}

export function initTitleBarSync(getter: () => string): void {
  appThemeGetter = getter
  nativeTheme.on('updated', () => {
    if (appThemeGetter) {
      updateNativeTitleBarFromSettings(appThemeGetter())
    }
  })
}
