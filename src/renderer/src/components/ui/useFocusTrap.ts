import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null when the element or an ancestor is display:none.
    el => !el.hasAttribute('disabled') && el.offsetParent !== null && el.tabIndex !== -1
  )
}

export default function useFocusTrap(isOpen: boolean, defaultFocusRef?: React.RefObject<HTMLElement | null>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerRef = useRef<any>(null)

  useEffect(() => {
    if (!isOpen) return
    const container = containerRef.current as HTMLElement | null
    if (!container) return

    // Whatever opened the overlay gets focus back when it closes, otherwise the
    // tab order restarts from the top of the document.
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Deferred: on the opening frame the container may still be mid-layout, so
    // offsetParent reads null and every candidate is filtered out.
    const timer = setTimeout(() => {
      const target = defaultFocusRef?.current ?? focusableWithin(container)[0]
      target?.focus()
    }, 50)

    return () => {
      clearTimeout(timer)
      previouslyFocused?.focus?.()
    }
  }, [isOpen, defaultFocusRef])

  useEffect(() => {
    if (!isOpen) return
    const container = containerRef.current as HTMLElement | null
    if (!container) return

    // Bound to the container rather than the window: with the listener on the
    // window, a nested overlay and its parent both trap and fight over Tab.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = focusableWithin(container)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        last.focus()
        e.preventDefault()
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus()
        e.preventDefault()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return containerRef
}
