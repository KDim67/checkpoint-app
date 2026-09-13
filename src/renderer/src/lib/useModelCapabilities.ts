import { useState, useEffect } from 'react'
import {
  defaultCapabilities,
  TIER_BUDGETS,
  type ModelCapabilities,
  type TierBudget
} from '../../../shared/modelCapabilities'
import * as aiApi from '../data/ai'

/** name-derived defaults first, then the endpoint's answer; usually one cached IPC trip */
export function useModelCapabilities(model: string): {
  caps: ModelCapabilities
  budget: TierBudget
  loading: boolean
  refresh: () => void
} {
  const [caps, setCaps] = useState<ModelCapabilities>(() => defaultCapabilities(model))
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    // reset to the name guess so the old model's window never budgets the new prompt
    setCaps(defaultCapabilities(model))
    if (!model) return

    setLoading(true)
    aiApi.getCapabilities(model, nonce > 0)
      .then(next => {
        if (!cancelled && next) setCaps(next)
      })
      .catch(err => console.error('Failed to read model capabilities:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [model, nonce])

  return {
    caps,
    budget: TIER_BUDGETS[caps.tier],
    loading,
    refresh: () => setNonce(n => n + 1)
  }
}
