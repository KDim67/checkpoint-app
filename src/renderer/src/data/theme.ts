/** theme CSS pushed from main */

type Api = typeof window.electronAPI

export const onThemeUpdate = (...args: Parameters<Api['onThemeUpdate']>): ReturnType<Api['onThemeUpdate']> =>
  window.electronAPI.onThemeUpdate(...args)
