type Bridge = typeof window.electronAPI.gamedev

export const batchRename = (...args: Parameters<Bridge['batchRename']>): ReturnType<Bridge['batchRename']> =>
  window.electronAPI.gamedev.batchRename(...args)

export const loadTexture = (...args: Parameters<Bridge['loadTexture']>): ReturnType<Bridge['loadTexture']> =>
  window.electronAPI.gamedev.loadTexture(...args)

export const saveLut = (...args: Parameters<Bridge['saveLut']>): ReturnType<Bridge['saveLut']> =>
  window.electronAPI.gamedev.saveLut(...args)

export const saveMaps = (...args: Parameters<Bridge['saveMaps']>): ReturnType<Bridge['saveMaps']> =>
  window.electronAPI.gamedev.saveMaps(...args)

export const saveSeamless = (...args: Parameters<Bridge['saveSeamless']>): ReturnType<Bridge['saveSeamless']> =>
  window.electronAPI.gamedev.saveSeamless(...args)

export const saveSlices = (...args: Parameters<Bridge['saveSlices']>): ReturnType<Bridge['saveSlices']> =>
  window.electronAPI.gamedev.saveSlices(...args)

export const saveSpriteAtlas = (...args: Parameters<Bridge['saveSpriteAtlas']>): ReturnType<Bridge['saveSpriteAtlas']> =>
  window.electronAPI.gamedev.saveSpriteAtlas(...args)

export const saveUpscaled = (...args: Parameters<Bridge['saveUpscaled']>): ReturnType<Bridge['saveUpscaled']> =>
  window.electronAPI.gamedev.saveUpscaled(...args)

export const selectSpriteFolder = (...args: Parameters<Bridge['selectSpriteFolder']>): ReturnType<Bridge['selectSpriteFolder']> =>
  window.electronAPI.gamedev.selectSpriteFolder(...args)

export const selectTexture = (...args: Parameters<Bridge['selectTexture']>): ReturnType<Bridge['selectTexture']> =>
  window.electronAPI.gamedev.selectTexture(...args)
