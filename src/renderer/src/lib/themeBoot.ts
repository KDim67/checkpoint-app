/** satellite windows skip App's startup effect; apply both the light/dark attribute and engine CSS */

import * as customizerApi from '../data/customizer'
import { getSetting } from '../data/settings'
import { onThemeUpdate } from '../data/theme'

const STYLE_ELEMENT_ID = 'user-theme'

/** injects or replaces */
function injectCustomCss(css: string): void {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  el.textContent = css
}

/** resolve 'system' here, index.css keys light off an explicit attribute */
export async function applyStoredTheme(): Promise<void> {
  try {
    const [stored, css] = await Promise.all([
      getSetting('app_theme').catch(() => null),
      customizerApi.getCss().catch(() => '')
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

/** the engine pushes CSS; the attribute is re-read on show since hidden popups get nothing */
export function watchTheme(): () => void {
  const unsubscribe = onThemeUpdate(injectCustomCss)
  const onFocus = (): void => { applyStoredTheme() }
  window.addEventListener('focus', onFocus)
  return () => {
    unsubscribe()
    window.removeEventListener('focus', onFocus)
  }
}
