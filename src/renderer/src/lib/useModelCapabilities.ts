import { useState, useEffect } from 'react'
import {
  defaultCapabilities,
  TIER_BUDGETS,
  type ModelCapabilities,
  type TierBudget
} from '../../../shared/modelCapabilities'

/**
 * Capabilities for the selected model, discovered in the main process.
 *
 * Starts from the name-derived defaults so the first render has real numbers
 * rather than nothing, then swaps in whatever the endpoint reports. Discovery
 * is cached in settings, so this is usually a single fast IPC round-trip.
 */
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
    // Reset to the name-derived guess immediately so a stale model's window
    // size is never used to budget the new model's prompt.
    setCaps(defaultCapabilities(model))
    if (!model) return

    setLoading(true)
    window.electronAPI.ai
      .getCapabilities(model, nonce > 0)
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
