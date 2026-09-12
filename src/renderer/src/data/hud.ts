/** The bridge's `hud` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.hud

export const onReset = (...args: Parameters<Bridge['onReset']>): ReturnType<Bridge['onReset']> =>
  window.electronAPI.hud.onReset(...args)

export const resize = (...args: Parameters<Bridge['resize']>): ReturnType<Bridge['resize']> =>
  window.electronAPI.hud.resize(...args)

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.hud.toggle(...args)
