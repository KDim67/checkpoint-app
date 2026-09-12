/** The bridge's `ollama` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.ollama

export const listLocal = (...args: Parameters<Bridge['listLocal']>): ReturnType<Bridge['listLocal']> =>
  window.electronAPI.ollama.listLocal(...args)
