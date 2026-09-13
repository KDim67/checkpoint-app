import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // offsetParent is null under display:none
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

    // hand focus back or tab order restarts at the top
    const previouslyFocused = document.activeElement as HTMLElement | null

    // deferred: mid-layout offsetParent reads null
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

    // on the container, window listeners let nested traps fight over Tab
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
