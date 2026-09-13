type Bridge = typeof window.electronAPI.notes

export const deleteNote = (...args: Parameters<Bridge['deleteNote']>): ReturnType<Bridge['deleteNote']> =>
  window.electronAPI.notes.deleteNote(...args)

export const importVault = (...args: Parameters<Bridge['importVault']>): ReturnType<Bridge['importVault']> =>
  window.electronAPI.notes.importVault(...args)

export const listNotes = (...args: Parameters<Bridge['listNotes']>): ReturnType<Bridge['listNotes']> =>
  window.electronAPI.notes.listNotes(...args)

export const readNote = (...args: Parameters<Bridge['readNote']>): ReturnType<Bridge['readNote']> =>
  window.electronAPI.notes.readNote(...args)

export const searchNotes = (...args: Parameters<Bridge['searchNotes']>): ReturnType<Bridge['searchNotes']> =>
  window.electronAPI.notes.searchNotes(...args)

export const writeNote = (...args: Parameters<Bridge['writeNote']>): ReturnType<Bridge['writeNote']> =>
  window.electronAPI.notes.writeNote(...args)
