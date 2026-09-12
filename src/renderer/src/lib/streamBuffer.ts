/**
 * Paces a stream of tokens into React state.
 *
 * A model emits chunks far faster than a screen can usefully redraw, so setting
 * state per chunk spends the whole frame budget on re-renders and the text
 * arrives jerkily. This lets one update through every 50ms and folds the rest
 * into a single animation frame, which is what both streaming panels were doing
 * with their own copy of the same three refs.
 *
 * Not a hook: the panels hold their refs across effects that register and
 * unregister IPC listeners, and a hook would tie the buffer to a render.
 */

/** A screen cannot show more than this usefully, and the eye cannot read it. */
const MIN_UPDATE_GAP_MS = 50

export interface StreamBuffer {
  /** Adds a chunk and pushes the text on when it is time to. */
  push: (chunk: string) => void
  /** Everything received so far. */
  text: () => string
  /** Cancels any pending frame and hands back the final text. */
  flush: () => string
  /** Drops what is buffered, for a stream that is starting over. */
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
