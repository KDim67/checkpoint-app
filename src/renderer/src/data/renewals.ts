type Bridge = typeof window.electronAPI.renewals

export const list = (...args: Parameters<Bridge['list']>): ReturnType<Bridge['list']> =>
  window.electronAPI.renewals.list(...args)

export const create = (...args: Parameters<Bridge['create']>): ReturnType<Bridge['create']> =>
  window.electronAPI.renewals.create(...args)

export const update = (...args: Parameters<Bridge['update']>): ReturnType<Bridge['update']> =>
  window.electronAPI.renewals.update(...args)

export const renewed = (...args: Parameters<Bridge['renewed']>): ReturnType<Bridge['renewed']> =>
  window.electronAPI.renewals.renewed(...args)

export const restore = (...args: Parameters<Bridge['restore']>): ReturnType<Bridge['restore']> =>
  window.electronAPI.renewals.restore(...args)

export const remove = (...args: Parameters<Bridge['remove']>): ReturnType<Bridge['remove']> =>
  window.electronAPI.renewals.remove(...args)

export const snooze = (...args: Parameters<Bridge['snooze']>): ReturnType<Bridge['snooze']> =>
  window.electronAPI.renewals.snooze(...args)

export const checkNow = (...args: Parameters<Bridge['checkNow']>): ReturnType<Bridge['checkNow']> =>
  window.electronAPI.renewals.checkNow(...args)

export const kinds = (...args: Parameters<Bridge['kinds']>): ReturnType<Bridge['kinds']> =>
  window.electronAPI.renewals.kinds(...args)

export const saveKinds = (...args: Parameters<Bridge['saveKinds']>): ReturnType<Bridge['saveKinds']> =>
  window.electronAPI.renewals.saveKinds(...args)

export const renameField = (...args: Parameters<Bridge['renameField']>): ReturnType<Bridge['renameField']> =>
  window.electronAPI.renewals.renameField(...args)

export const fieldUses = (...args: Parameters<Bridge['fieldUses']>): ReturnType<Bridge['fieldUses']> =>
  window.electronAPI.renewals.fieldUses(...args)
