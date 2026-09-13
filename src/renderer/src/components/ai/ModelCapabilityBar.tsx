import React from 'react'
import { RefreshCw } from 'lucide-react'
import type { ModelCapabilities, ModelTier } from '../../../../shared/modelCapabilities'

const TIER_LABEL: Record<ModelTier, string> = {
  tiny: 'Tiny',
  small: 'Small',
  mid: 'Mid',
  large: 'Large',
  frontier: 'Frontier'
}

const TIER_COLOR: Record<ModelTier, string> = {
  tiny: 'var(--color-warning)',
  small: 'var(--color-warning)',
  mid: 'var(--color-primary)',
  large: 'var(--color-secondary)',
  frontier: 'var(--color-secondary)'
}

function formatContext(tokens: number): string {
  if (tokens >= 1000000) return `${Math.round(tokens / 100000) / 10}M ctx`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`
  return `${tokens} ctx`
}

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontSize: 'var(--text-2xs)',
        fontWeight: 'var(--weight-semibold)',
        color: color || 'var(--color-text-muted)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px var(--space-1-5)',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  )
}

/** shows where the belief came from; "name" or "default" means refresh or fix the endpoint */
export default function ModelCapabilityBar({
  caps,
  onRefresh
}: {
  caps: ModelCapabilities
  onRefresh: () => void
}) {
  if (!caps.model) return null

  const sourceLabel =
    caps.source === 'endpoint' ? 'reported by the endpoint'
    : caps.source === 'curated' ? 'from the built-in table for this model family'
    : caps.source === 'name' ? 'inferred from the model name. May be wrong'
    : 'fallback defaults, because the endpoint did not answer'

  return (
    <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'wrap' }}>
      <Badge color={TIER_COLOR[caps.tier]}>
        {TIER_LABEL[caps.tier]}
        {caps.paramsB !== null ? ` · ${caps.paramsB}B` : ''}
      </Badge>
      <Badge>{formatContext(caps.contextTokens)}</Badge>
      {caps.supportsTools && <Badge>tools</Badge>}
      {caps.supportsVision && <Badge>vision</Badge>}
      {caps.reasoningStyle !== 'none' && <Badge>reasoning</Badge>}
      {caps.quantization && <Badge>{caps.quantization}</Badge>}

      <span
        title={sourceLabel}
        style={{
          fontSize: 'var(--text-2xs)',
          color: caps.source === 'endpoint' ? 'var(--color-text-faint)' : 'var(--color-warning)'
        }}
      >
        {caps.source === 'endpoint' ? 'detected' : caps.source}
      </span>

      <button
        className="btn-icon"
        onClick={onRefresh}
        aria-label="Re-detect model capabilities"
        title="Re-detect model capabilities"
        style={{ width: '20px', height: '20px', marginLeft: 'auto' }}
      >
        <RefreshCw size={11} />
      </button>
    </div>
  )
}
