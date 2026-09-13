import { useEffect, useState } from 'react'
import { flattenToHex } from '../../../shared/color'

/** for things that can't use var(), like mermaid */

export function themeToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** opaque hex composited over `over`: mermaid's classDef grammar breaks on rgba */
export function themeTokenHex(name: string, fallback: string, over: string): string {
  const flattened = flattenToHex(themeToken(name, fallback), themeToken(over, '#000000'))
  return flattened ?? fallback
}

/** bumps on theme change so resolved colours get re-read */
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
