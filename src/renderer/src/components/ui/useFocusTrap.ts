import { useEffect, useRef } from 'react'

export default function useFocusTrap(isOpen: boolean, defaultFocusRef?: React.RefObject<HTMLElement | null>) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    // Focus default element on open
    if (defaultFocusRef && defaultFocusRef.current) {
      const timer = setTimeout(() => {
        defaultFocusRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    } else if (containerRef.current) {
      // Fallback: focus first focusable element
      const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      const activeElements = Array.from(focusableElements).filter(el => {
        return !el.hasAttribute('disabled') && (el as HTMLElement).tabIndex !== -1
      })
      if (activeElements.length > 0) {
        const timer = setTimeout(() => {
          (activeElements[0] as HTMLElement).focus()
        }, 50)
        return () => clearTimeout(timer)
      }
    }
    return undefined
  }, [isOpen, defaultFocusRef])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (!containerRef.current) return

      const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      const focusableElements = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter(el => {
        // Filter out disabled elements and those with display: none or offsetParent === null
        // offsetParent is null when the element or its parent is display: none.
        return !el.hasAttribute('disabled') && el.offsetParent !== null && el.tabIndex !== -1
      })

      if (focusableElements.length === 0) {
        e.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement.focus()
          e.preventDefault()
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          firstElement.focus()
          e.preventDefault()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return containerRef
}
