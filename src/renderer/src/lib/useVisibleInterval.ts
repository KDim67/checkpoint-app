import { useEffect, useRef } from 'react'

/**
 * Runs an interval only while the window is visible, firing immediately
 * when the user switches back from hidden/minimized state.
 */
export function useVisibleInterval(callback: () => void, delayMs: number, enabled = true): void {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (!enabled || delayMs <= 0) return

    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer !== null || document.hidden) return
      timer = setInterval(() => {
        if (!document.hidden) savedCallback.current()
      }, delayMs)
    }

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    const handleVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        savedCallback.current()
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [delayMs, enabled])
}
