type Bridge = typeof window.electronAPI.memory

export const auditMemories = (...args: Parameters<Bridge['auditMemories']>): ReturnType<Bridge['auditMemories']> =>
  window.electronAPI.memory.auditMemories(...args)

export const consolidateMemory = (...args: Parameters<Bridge['consolidateMemory']>): ReturnType<Bridge['consolidateMemory']> =>
  window.electronAPI.memory.consolidateMemory(...args)

export const deleteMemory = (...args: Parameters<Bridge['deleteMemory']>): ReturnType<Bridge['deleteMemory']> =>
  window.electronAPI.memory.deleteMemory(...args)

export const getMemories = (...args: Parameters<Bridge['getMemories']>): ReturnType<Bridge['getMemories']> =>
  window.electronAPI.memory.getMemories(...args)

export const saveMemory = (...args: Parameters<Bridge['saveMemory']>): ReturnType<Bridge['saveMemory']> =>
  window.electronAPI.memory.saveMemory(...args)

export const searchMemories = (...args: Parameters<Bridge['searchMemories']>): ReturnType<Bridge['searchMemories']> =>
  window.electronAPI.memory.searchMemories(...args)

export const togglePinMemory = (...args: Parameters<Bridge['togglePinMemory']>): ReturnType<Bridge['togglePinMemory']> =>
  window.electronAPI.memory.togglePinMemory(...args)

export const updateMemoryContent = (...args: Parameters<Bridge['updateMemoryContent']>): ReturnType<Bridge['updateMemoryContent']> =>
  window.electronAPI.memory.updateMemoryContent(...args)
