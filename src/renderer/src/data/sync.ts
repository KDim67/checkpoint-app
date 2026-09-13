type Bridge = typeof window.electronAPI.sync

export const applyBoardBaseline = (...args: Parameters<Bridge['applyBoardBaseline']>): ReturnType<Bridge['applyBoardBaseline']> =>
  window.electronAPI.sync.applyBoardBaseline(...args)

export const applyDbPayload = (...args: Parameters<Bridge['applyDbPayload']>): ReturnType<Bridge['applyDbPayload']> =>
  window.electronAPI.sync.applyDbPayload(...args)

export const applyRemoteMutation = (...args: Parameters<Bridge['applyRemoteMutation']>): ReturnType<Bridge['applyRemoteMutation']> =>
  window.electronAPI.sync.applyRemoteMutation(...args)

export const connectAndSync = (...args: Parameters<Bridge['connectAndSync']>): ReturnType<Bridge['connectAndSync']> =>
  window.electronAPI.sync.connectAndSync(...args)

export const deleteFile = (...args: Parameters<Bridge['deleteFile']>): ReturnType<Bridge['deleteFile']> =>
  window.electronAPI.sync.deleteFile(...args)

export const getDbPayload = (...args: Parameters<Bridge['getDbPayload']>): ReturnType<Bridge['getDbPayload']> =>
  window.electronAPI.sync.getDbPayload(...args)

export const getDiscoveredPeers = (...args: Parameters<Bridge['getDiscoveredPeers']>): ReturnType<Bridge['getDiscoveredPeers']> =>
  window.electronAPI.sync.getDiscoveredPeers(...args)

export const getFileIndex = (...args: Parameters<Bridge['getFileIndex']>): ReturnType<Bridge['getFileIndex']> =>
  window.electronAPI.sync.getFileIndex(...args)

export const getStatus = (...args: Parameters<Bridge['getStatus']>): ReturnType<Bridge['getStatus']> =>
  window.electronAPI.sync.getStatus(...args)

export const readFileChunk = (...args: Parameters<Bridge['readFileChunk']>): ReturnType<Bridge['readFileChunk']> =>
  window.electronAPI.sync.readFileChunk(...args)

export const startHost = (...args: Parameters<Bridge['startHost']>): ReturnType<Bridge['startHost']> =>
  window.electronAPI.sync.startHost(...args)

export const stopHost = (...args: Parameters<Bridge['stopHost']>): ReturnType<Bridge['stopHost']> =>
  window.electronAPI.sync.stopHost(...args)

export const writeFileChunk = (...args: Parameters<Bridge['writeFileChunk']>): ReturnType<Bridge['writeFileChunk']> =>
  window.electronAPI.sync.writeFileChunk(...args)
