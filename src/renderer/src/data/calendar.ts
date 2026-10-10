type Bridge = typeof window.electronAPI.calendar

export const entries = (...args: Parameters<Bridge['entries']>): ReturnType<Bridge['entries']> =>
  window.electronAPI.calendar.entries(...args)

export const move = (...args: Parameters<Bridge['move']>): ReturnType<Bridge['move']> =>
  window.electronAPI.calendar.move(...args)

export const quickAdd = (...args: Parameters<Bridge['quickAdd']>): ReturnType<Bridge['quickAdd']> =>
  window.electronAPI.calendar.quickAdd(...args)

export const subscriptions = (...args: Parameters<Bridge['subscriptions']>): ReturnType<Bridge['subscriptions']> =>
  window.electronAPI.calendar.subscriptions(...args)

export const subscribe = (...args: Parameters<Bridge['subscribe']>): ReturnType<Bridge['subscribe']> =>
  window.electronAPI.calendar.subscribe(...args)

export const updateSubscription = (...args: Parameters<Bridge['updateSubscription']>): ReturnType<Bridge['updateSubscription']> =>
  window.electronAPI.calendar.updateSubscription(...args)

export const unsubscribe = (...args: Parameters<Bridge['unsubscribe']>): ReturnType<Bridge['unsubscribe']> =>
  window.electronAPI.calendar.unsubscribe(...args)

export const refresh = (...args: Parameters<Bridge['refresh']>): ReturnType<Bridge['refresh']> =>
  window.electronAPI.calendar.refresh(...args)

export const onChanged = (...args: Parameters<Bridge['onChanged']>): ReturnType<Bridge['onChanged']> =>
  window.electronAPI.calendar.onChanged(...args)
