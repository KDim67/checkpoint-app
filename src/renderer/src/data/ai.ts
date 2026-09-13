type Bridge = typeof window.electronAPI.ai

export const abortStream = (...args: Parameters<Bridge['abortStream']>): ReturnType<Bridge['abortStream']> =>
  window.electronAPI.ai.abortStream(...args)

export const abortStructured = (...args: Parameters<Bridge['abortStructured']>): ReturnType<Bridge['abortStructured']> =>
  window.electronAPI.ai.abortStructured(...args)

export const generateStructured = (...args: Parameters<Bridge['generateStructured']>): ReturnType<Bridge['generateStructured']> =>
  window.electronAPI.ai.generateStructured(...args)

export const getCapabilities = (...args: Parameters<Bridge['getCapabilities']>): ReturnType<Bridge['getCapabilities']> =>
  window.electronAPI.ai.getCapabilities(...args)

export const onChunk = (...args: Parameters<Bridge['onChunk']>): ReturnType<Bridge['onChunk']> =>
  window.electronAPI.ai.onChunk(...args)

export const onDone = (...args: Parameters<Bridge['onDone']>): ReturnType<Bridge['onDone']> =>
  window.electronAPI.ai.onDone(...args)

export const onError = (...args: Parameters<Bridge['onError']>): ReturnType<Bridge['onError']> =>
  window.electronAPI.ai.onError(...args)

export const startStream = (...args: Parameters<Bridge['startStream']>): ReturnType<Bridge['startStream']> =>
  window.electronAPI.ai.startStream(...args)

export const testConnection = (...args: Parameters<Bridge['testConnection']>): ReturnType<Bridge['testConnection']> =>
  window.electronAPI.ai.testConnection(...args)
