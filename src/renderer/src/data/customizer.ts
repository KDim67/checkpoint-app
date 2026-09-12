/** The bridge's `customizer` calls, as the renderer reaches them. Typed off the bridge. */

type Bridge = typeof window.electronAPI.customizer

export const getCss = (...args: Parameters<Bridge['getCss']>): ReturnType<Bridge['getCss']> =>
  window.electronAPI.customizer.getCss(...args)

export const getEngineState = (...args: Parameters<Bridge['getEngineState']>): ReturnType<Bridge['getEngineState']> =>
  window.electronAPI.customizer.getEngineState(...args)

export const getPlugins = (...args: Parameters<Bridge['getPlugins']>): ReturnType<Bridge['getPlugins']> =>
  window.electronAPI.customizer.getPlugins(...args)

export const getShortcuts = (...args: Parameters<Bridge['getShortcuts']>): ReturnType<Bridge['getShortcuts']> =>
  window.electronAPI.customizer.getShortcuts(...args)

export const getTheme = (...args: Parameters<Bridge['getTheme']>): ReturnType<Bridge['getTheme']> =>
  window.electronAPI.customizer.getTheme(...args)

export const installExample = (...args: Parameters<Bridge['installExample']>): ReturnType<Bridge['installExample']> =>
  window.electronAPI.customizer.installExample(...args)

export const openPluginsFolder = (...args: Parameters<Bridge['openPluginsFolder']>): ReturnType<Bridge['openPluginsFolder']> =>
  window.electronAPI.customizer.openPluginsFolder(...args)

export const registerShortcuts = (...args: Parameters<Bridge['registerShortcuts']>): ReturnType<Bridge['registerShortcuts']> =>
  window.electronAPI.customizer.registerShortcuts(...args)

export const toggleEngine = (...args: Parameters<Bridge['toggleEngine']>): ReturnType<Bridge['toggleEngine']> =>
  window.electronAPI.customizer.toggleEngine(...args)

export const togglePlugin = (...args: Parameters<Bridge['togglePlugin']>): ReturnType<Bridge['togglePlugin']> =>
  window.electronAPI.customizer.togglePlugin(...args)

export const updateTheme = (...args: Parameters<Bridge['updateTheme']>): ReturnType<Bridge['updateTheme']> =>
  window.electronAPI.customizer.updateTheme(...args)
