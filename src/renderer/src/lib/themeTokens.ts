import { useEffect, useState } from 'react'

/**
 * Concrete colours for the things that cannot use CSS custom properties.
 *
 * Almost everything in this app is styled with `var(--token)` and follows the
 * theme for free. Mermaid does not: it resolves colours away from the DOM,
 * where a `var()` has nothing to resolve against, so it has to be handed real
 * values. Reading them off the document is the same thing one step later.
 */

/** The value of a CSS custom property, resolved against the document. */
export function themeToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Bumps whenever the theme changes, so anything holding resolved colours knows
 * to read them again.
 *
 * Watches `data-theme`, which the toggle and the settings page set, along with
 * the inline properties and classes the Appearance tab writes while a theme is
 * being edited live.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => setVersion(v => v + 1))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-compact', 'style', 'class']
    })
    return () => observer.disconnect()
  }, [])

  return version
}
