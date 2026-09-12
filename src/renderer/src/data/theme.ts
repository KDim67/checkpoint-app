/** The theme CSS the main process pushes when it changes. Typed off the bridge. */

type Api = typeof window.electronAPI

export const onThemeUpdate = (...args: Parameters<Api['onThemeUpdate']>): ReturnType<Api['onThemeUpdate']> =>
  window.electronAPI.onThemeUpdate(...args)
