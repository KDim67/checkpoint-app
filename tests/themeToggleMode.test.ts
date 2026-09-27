// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { injectCustomCss } from '../src/renderer/src/lib/themeBoot'
import { DEFAULT_THEME, deriveThemeVars, buildCssVariablesString } from '../src/shared/themePresets'

describe('Theme Toggle and Custom Theme Cycling', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme-custom')
    document.documentElement.setAttribute('data-theme', 'dark')
    const existing = document.getElementById('user-theme')
    if (existing) existing.remove()
  })

  it('injectCustomCss adds data-theme-custom attribute when css is non-empty', () => {
    const css = buildCssVariablesString(deriveThemeVars(DEFAULT_THEME))
    injectCustomCss(css)

    expect(document.documentElement.getAttribute('data-theme-custom')).toBe('true')
    const el = document.getElementById('user-theme')
    expect(el).not.toBeNull()
    expect(el?.textContent).toContain('--color-background')
  })

  it('injectCustomCss removes data-theme-custom attribute and clears styles when css is empty', () => {
    // First inject
    const css = buildCssVariablesString(deriveThemeVars(DEFAULT_THEME))
    injectCustomCss(css)
    expect(document.documentElement.getAttribute('data-theme-custom')).toBe('true')

    // Now clear
    injectCustomCss('')
    expect(document.documentElement.getAttribute('data-theme-custom')).toBeNull()
    const el = document.getElementById('user-theme')
    expect(el?.textContent).toBe('')
  })

  it('cycles from dark -> light (disabling custom theme) -> custom -> dark', () => {
    type ThemeMode = 'dark' | 'light' | 'custom'

    let mode: ThemeMode = 'dark'
    let customizerEnabled = false

    const toggle = (current: ThemeMode): ThemeMode => {
      if (current === 'dark') {
        // Night -> Day (disables custom theme)
        customizerEnabled = false
        injectCustomCss('')
        document.documentElement.setAttribute('data-theme', 'light')
        return 'light'
      } else if (current === 'light') {
        // Day -> Custom (enables custom theme)
        customizerEnabled = true
        const css = buildCssVariablesString(deriveThemeVars(DEFAULT_THEME))
        injectCustomCss(css)
        document.documentElement.setAttribute('data-theme', 'dark')
        return 'custom'
      } else {
        // Custom -> Night (disables custom theme)
        customizerEnabled = false
        injectCustomCss('')
        document.documentElement.setAttribute('data-theme', 'dark')
        return 'dark'
      }
    }

    // Step 1: Start at dark
    expect(mode).toBe('dark')
    expect(customizerEnabled).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme-custom')).toBeNull()

    // Step 2: Toggle to light
    mode = toggle(mode)
    expect(mode).toBe('light')
    expect(customizerEnabled).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme-custom')).toBeNull()

    // Step 3: Toggle to custom
    mode = toggle(mode)
    expect(mode).toBe('custom')
    expect(customizerEnabled).toBe(true)
    expect(document.documentElement.getAttribute('data-theme-custom')).toBe('true')
    expect(document.getElementById('user-theme')?.textContent).toContain('--color-background')

    // Step 4: Toggle back to dark
    mode = toggle(mode)
    expect(mode).toBe('dark')
    expect(customizerEnabled).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme-custom')).toBeNull()
    expect(document.getElementById('user-theme')?.textContent).toBe('')
  })
})
