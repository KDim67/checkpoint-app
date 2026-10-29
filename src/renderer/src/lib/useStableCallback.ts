/** a function that keeps its identity across renders but always runs the latest one, so a memoised child isn't redrawn for it */

import { useCallback, useLayoutEffect, useRef } from 'react'

export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: A) => latest.current(...args), [])
}
