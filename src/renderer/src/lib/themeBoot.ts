/**
 * Applies the user's theme in a window that is not the main one.
 *
 * The tray panel, widget and quick-capture HUD are each their own renderer and
 * none runs App's startup effect, so without this they paint index.css defaults
 * whatever the app is themed.
 *
 * Both halves are needed or the window looks half-right: the light/dark
 * attribute, and the customization engine's CSS.
 */

const STYLE_ELEMENT_ID = 'user-theme'

/** Injects (or replaces) the customization engine's stylesheet. */
export function injectCustomCss(css: string): void {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  el.textContent = css
}

/**
 * Reads the stored theme and applies it to this window.
 *
 * Resolves the 'system' setting here rather than leaving the attribute unset:
 * index.css keys its light palette off an explicit `data-theme="light"`, so an
 * absent attribute would always render dark regardless of the OS.
 */
export async function applyStoredTheme(): Promise<void> {
  try {
    const [stored, css] = await Promise.all([
      window.electronAPI.db.getSetting('app_theme').catch(() => null),
      window.electronAPI.customizer.getCss().catch(() => '')
    ])

    const resolved =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
    document.documentElement.setAttribute('data-theme', resolved)

    if (css) injectCustomCss(css)
  } catch (err) {
    console.error('[theme] Could not apply the stored theme:', err)
  }
}

/**
 * Keeps a satellite window in step with later theme changes.
 *
 * Returns an unsubscribe. Both halves are watched: the engine pushes CSS, and
 * the light/dark attribute is re-read when the window is shown again, since a
 * hidden popup receives nothing while it is not on screen.
 */
export function watchTheme(): () => void {
  const unsubscribe = window.electronAPI.onThemeUpdate(injectCustomCss)
  const onFocus = (): void => { applyStoredTheme() }
  window.addEventListener('focus', onFocus)
  return () => {
    unsubscribe()
    window.removeEventListener('focus', onFocus)
  }
}
