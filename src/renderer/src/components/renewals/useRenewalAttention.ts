import { useEffect, useState } from 'react'
import * as renewalsApi from '../../data/renewals'
import * as mcpApi from '../../data/mcp'
import { needsAttention } from '../../../../shared/renewal'
import { RENEWALS_CHANGED_EVENT } from './useRenewals'

/** half an hour: "within a week" moves by the day, nothing here needs the minute */
const REFRESH_MS = 30 * 60 * 1000

/** how many want a look, for the sidebar badge; quietly zero when the count can't be had */
export function useRenewalAttention(enabled: boolean): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const list = await renewalsApi.list()
        const now = Date.now()
        if (alive && list.ok) setCount(list.value.filter(r => needsAttention(r.status, r.meta, now)).length)
      } catch (err) {
        console.error('[renewals] Could not count what needs a look:', err)
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, REFRESH_MS)
    const onChange = (): void => { void load() }
    window.addEventListener(RENEWALS_CHANGED_EVENT, onChange)
    const stop = mcpApi.onDataChanged(onChange)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener(RENEWALS_CHANGED_EVENT, onChange)
      stop()
    }
  }, [enabled])

  return count
}
