/** React.lazy for code that can also be fetched ahead of time */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

export type Preloadable<T extends ComponentType> = LazyExoticComponent<T> & {
  /** fetches the code without showing anything; never throws, a failed fetch is tried again on use */
  preload: () => Promise<void>
}

/** a thenable that answers at once, so React takes code already here without suspending for it */
function settled<V>(value: V): Promise<V> {
  return { then: (resolve: (v: V) => unknown) => resolve(value) } as unknown as Promise<V>
}

/** like lazy, but code fetched ahead opens straight away; otherwise React shows the loading screen and keeps it up for 300 ms */
export function lazyView<T extends ComponentType>(load: () => Promise<{ default: T }>): Preloadable<T> {
  let loaded: { default: T } | null = null
  let loading: Promise<{ default: T }> | null = null
  const fetchCode = (): Promise<{ default: T }> => {
    loading ??= load().then(
      module => (loaded = module),
      err => {
        loading = null
        throw err
      }
    )
    return loading
  }
  const view = lazy(() => (loaded ? settled(loaded) : fetchCode())) as Preloadable<T>
  view.preload = () => fetchCode().then(() => undefined, () => undefined)
  return view
}
