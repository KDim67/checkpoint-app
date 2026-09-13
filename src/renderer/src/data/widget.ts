type Bridge = typeof window.electronAPI.widget

export const setOpacity = (...args: Parameters<Bridge['setOpacity']>): ReturnType<Bridge['setOpacity']> =>
  window.electronAPI.widget.setOpacity(...args)

export const setPosition = (...args: Parameters<Bridge['setPosition']>): ReturnType<Bridge['setPosition']> =>
  window.electronAPI.widget.setPosition(...args)

export const toggle = (...args: Parameters<Bridge['toggle']>): ReturnType<Bridge['toggle']> =>
  window.electronAPI.widget.toggle(...args)
