/** one update per 50ms, the rest folded into a frame; not a hook so refs survive listener effects */

/** the eye can't read faster */
const MIN_UPDATE_GAP_MS = 50

export interface StreamBuffer {
  /** pushes when due */
  push: (chunk: string) => void
  text: () => string
  /** cancels the pending frame, returns the final text */
  flush: () => string
  /** for a stream starting over */
  reset: () => void
}

export function createStreamBuffer(onText: (text: string) => void): StreamBuffer {
  let buffer = ''
  let lastUpdate = 0
  let frame: number | null = null

  const cancel = (): void => {
    if (frame === null) return
    cancelAnimationFrame(frame)
    frame = null
  }

  return {
    push(chunk) {
      buffer += chunk
      const now = Date.now()
      if (now - lastUpdate > MIN_UPDATE_GAP_MS) {
        lastUpdate = now
        onText(buffer)
        return
      }
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        onText(buffer)
      })
    },
    text: () => buffer,
    flush() {
      cancel()
      return buffer
    },
    reset() {
      cancel()
      buffer = ''
      lastUpdate = 0
    }
  }
}
