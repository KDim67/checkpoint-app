import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Cpu,
  Database,
  Layers,
  RefreshCw,
  Download,
  CheckCircle,
  AlertTriangle,
  StopCircle,
  ExternalLink,
  Info,
  Search,
  Trash2,
  Sparkles,
  X
} from 'lucide-react'
import catalogData from '../../../../shared/catalog.json'
import { calculateFitResult, USABLE_RAM_FRACTION } from '../../../../shared/scoreEngine'
import type { CatalogModel, HardwareSpecs, OllamaStatus, PullProgressEvent } from '../../../../shared/cookbookTypes'
import SettingsSection from './SettingsSection'
import Skeleton from '../ui/Skeleton'
import EmptyState from '../ui/EmptyState'
import { useToast, useFailureReport } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { getBoolSetting, setBoolSetting } from '../../lib/settings'
import * as cookbookApi from '../../data/cookbook'
import * as appApi from '../../data/app'

const CAP_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'code', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'vision', label: 'Vision' },
  { id: 'tools', label: 'Tools' },
  { id: 'embedding', label: 'Embedding' },
  { id: 'tiny', label: 'Tiny ≤4B' }
]

const CAP_META: Record<string, { label: string; color: string }> = {
  code:      { label: 'Code',      color: '#3b82f6' },
  reasoning: { label: 'Reasoning', color: '#a855f7' },
  vision:    { label: 'Vision',    color: '#ec4899' },
  tools:     { label: 'Tools',     color: '#22c55e' },
  chat:      { label: 'Chat',      color: '#64748b' },
  embedding: { label: 'Embedding', color: '#f59e0b' }
}

const SAFE_MODE_MAX_PARAMS = 4

function formatPlatform(platform: string): string {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  if (tokens >= 1000) return `${Math.round(tokens / 1024)}K ctx`
  return `${tokens} ctx`
}

function SpecTile({ icon, label, value, detail }: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        minWidth: 0
      }}
    >
      <div style={{ color: 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="label-caps-sm">{label}</div>
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={value}
        >
          {value}
        </div>
        <div
          className="text-nano"
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={detail}
        >
          {detail}
        </div>
      </div>
    </div>
  )
}

interface Props {
  activeModel?: string
  onUseModel?: (modelTag: string) => void
}

export default function LocalModelsSection({ activeModel, onUseModel }: Props) {
  const { toast } = useToast()
  const report = useFailureReport()
  const confirm = useConfirm()
  const [searchQuery, setSearchQuery] = useState('')
  const [capFilter, setCapFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'fit' | 'params_asc' | 'params_desc'>('fit')
  const [deletingTag, setDeletingTag] = useState<string | null>(null)
  const [specs, setSpecs] = useState<HardwareSpecs | null>(null)
  const [loadingSpecs, setLoadingSpecs] = useState(true)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [loadingOllama, setLoadingOllama] = useState(true)
  const [safeMode, setSafeMode] = useState(false)

  const [pullingModelTag, setPullingModelTag] = useState<string | null>(null)
  const pullingModelTagRef = useRef<string | null>(null)
  const [pullPercent, setPullPercent] = useState(0)
  const [pullStatusText, setPullStatusText] = useState('')
  const [pullError, setPullError] = useState<string | null>(null)

  const updatePullingModel = (tag: string | null) => {
    setPullingModelTag(tag)
    pullingModelTagRef.current = tag
  }

  const loadHardwareSpecs = useCallback(async () => {
    setLoadingSpecs(true)
    try {
      setSpecs(await cookbookApi.getHardwareSpecs())
    } catch (err) {
      report("read this machine's hardware", err)
    } finally {
      setLoadingSpecs(false)
    }
  }, [report])

  const loadOllamaStatus = useCallback(async () => {
    setLoadingOllama(true)
    try {
      setOllamaStatus(await cookbookApi.checkOllama())
    } catch (err) {
      report('check whether Ollama is running', err)
    } finally {
      setLoadingOllama(false)
    }
  }, [report])

  useEffect(() => {
    loadHardwareSpecs()
    loadOllamaStatus()
    getBoolSetting('unitySafeMode', false)
      .then(setSafeMode)
      .catch(err => report('load the safe mode setting', err))
  }, [loadHardwareSpecs, loadOllamaStatus, report])

  useEffect(() => {
    const unsubscribeProgress = cookbookApi.onPullProgress((event: PullProgressEvent) => {
      updatePullingModel(event.modelId)
      setPullPercent(event.percent >= 0 ? event.percent : 0)
      setPullStatusText(event.status)
      setPullError(null)
    })

    const cleanDone = cookbookApi.onPullDone(() => {
      const tag = pullingModelTagRef.current
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
      setPullError(null)
      loadOllamaStatus()
      if (tag) toast(`Model "${tag}" installed`, { type: 'success' })
    })

    const cleanError = cookbookApi.onPullError((data: { modelTag: string; message: string }) => {
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
      setPullError(data.message)
      toast(`Failed to install "${data.modelTag}": ${data.message}`, { type: 'error' })
    })

    return () => {
      unsubscribeProgress()
      cleanDone()
      cleanError()
    }
  }, [toast, loadOllamaStatus])

  const handleToggleSafeMode = async (next: boolean) => {
    setSafeMode(next)
    try {
      await setBoolSetting('unitySafeMode', next)
    } catch (err) {
      report('save the safe mode setting', err)
    }
  }

  const handleInstall = async (modelTag: string, warning?: string) => {
    if (warning) {
      const ok = await confirm({
        title: 'Install anyway?',
        message: `${warning} You can install it regardless, but expect slower generation or load failures.`,
        confirmText: 'Install anyway'
      })
      if (!ok) return
    }
    setPullError(null)
    updatePullingModel(modelTag)
    setPullPercent(0)
    setPullStatusText('Connecting to Ollama…')
    try {
      await cookbookApi.pullModel(modelTag)
    } catch (err: unknown) {
      setPullError(err instanceof Error ? err.message : String(err))
      updatePullingModel(null)
    }
  }

  const handleAbort = async () => {
    const tag = pullingModelTagRef.current
    try {
      await cookbookApi.stopPull()
      if (tag) toast(`Pull of "${tag}" canceled.`)
    } catch (err) {
      report('stop the download', err)
    } finally {
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
    }
  }

  const handleDeleteModel = async (modelTag: string) => {
    const ok = await confirm({
      title: 'Delete model',
      message: `Delete "${modelTag}" from your machine? You can reinstall it anytime.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!ok) return
    setDeletingTag(modelTag)
    try {
      const deleted = await cookbookApi.deleteModel(modelTag)
      if (deleted) {
        toast(`Removed "${modelTag}"`, { type: 'success' })
        await loadOllamaStatus()
      } else {
        toast(`Could not remove "${modelTag}"`, { type: 'error' })
      }
    } catch (err) {
      report(`remove "${modelTag}"`, err)
    } finally {
      setDeletingTag(null)
    }
  }

  const catalogModels: CatalogModel[] = catalogData as CatalogModel[]
  const matchingModels = catalogModels.filter((m) => {
    if (capFilter === 'tiny') {
      if (m.parameters > SAFE_MODE_MAX_PARAMS) return false
    } else if (capFilter !== 'all') {
      if (!m.capabilities?.includes(capFilter as never)) return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matches =
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.useCases.some(uc => uc.toLowerCase().includes(q)) ||
        (m.capabilities || []).some(c => c.toLowerCase().includes(q))
      if (!matches) return false
    }
    return true
  })

  const filteredModels = (safeMode
    ? matchingModels.filter(m => m.parameters <= SAFE_MODE_MAX_PARAMS)
    : matchingModels
  ).sort((a, b) => {
    if (sortBy === 'params_asc') return a.parameters - b.parameters
    if (sortBy === 'params_desc') return b.parameters - a.parameters
    const fa = specs ? calculateFitResult(specs, a).score : 0
    const fb = specs ? calculateFitResult(specs, b).score : 0
    return fb !== fa ? fb - fa : a.parameters - b.parameters
  })

  const hiddenBySafeMode = matchingModels.length - filteredModels.length
  const localModels = ollamaStatus?.localModels || []

  return (
    <SettingsSection
      icon={<Cpu size={14} />}
      title="Local models"
      description="Check what fits this machine and install or remove Ollama models."
    >
      <div className="col-lg">
        {/* hardware summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 'var(--space-2)'
          }}
        >
          {loadingSpecs ? (
            <>
              <Skeleton height={62} borderRadius="var(--radius-md)" />
              <Skeleton height={62} borderRadius="var(--radius-md)" />
              <Skeleton height={62} borderRadius="var(--radius-md)" />
            </>
          ) : specs ? (
            <>
              <SpecTile
                icon={<Cpu size={16} />}
                label="Processor"
                value={`${specs.cpuCores}c / ${specs.cpuThreads}t`}
                detail={formatPlatform(specs.platform)}
              />
              <SpecTile
                icon={<Database size={16} />}
                label="Memory"
                value={`${specs.ramGb.toFixed(1)} GB RAM`}
                detail={`~${(specs.ramGb * USABLE_RAM_FRACTION).toFixed(1)} GB usable`}
              />
              <SpecTile
                icon={<Layers size={16} />}
                label="Graphics"
                value={specs.gpuName || 'No GPU detected'}
                detail={specs.vramGb > 0 ? `${specs.vramGb.toFixed(1)} GB VRAM` : 'CPU fallback'}
              />
            </>
          ) : (
            <div className="text-hint" style={{ gridColumn: '1 / -1' }}>
              Could not read this machine's hardware specs.
            </div>
          )}
        </div>

        {/* safe mode + refresh */}
        <div className="row-between-gap" style={{ flexWrap: 'wrap' }}>
          <div className="row-md" style={{ flex: 1, minWidth: '14rem' }}>
            <button
              type="button"
              onClick={() => handleToggleSafeMode(!safeMode)}
              role="switch"
              aria-checked={safeMode}
              aria-label="Safe Mode"
              className="settings-toggle"
            >
              <span className="settings-toggle-knob" />
            </button>
            <div onClick={() => handleToggleSafeMode(!safeMode)} style={{ cursor: 'pointer', userSelect: 'none' }}>
              <div className="field-label">Safe Mode</div>
              <div className="text-sub">
                Hide models over {SAFE_MODE_MAX_PARAMS}B parameters to preserve VRAM for other tools.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={() => { loadHardwareSpecs(); loadOllamaStatus() }}
            disabled={loadingSpecs || loadingOllama}
          >
            <RefreshCw size={12} className={loadingSpecs || loadingOllama ? 'animate-spin' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {pullError && (
          <div
            style={{
              background: 'var(--color-error-muted)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'start',
              gap: 'var(--space-2)'
            }}
          >
            <AlertTriangle size={14} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: '2px' }} />
            <div>{pullError}</div>
          </div>
        )}

        {!loadingOllama && ollamaStatus && !ollamaStatus.installed && (
          <div
            style={{
              background: 'var(--color-error-muted)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)'
            }}
          >
            <div className="row-8px">
              <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
              <span className="text-item-strong">Ollama not detected</span>
            </div>
            <p className="text-hint" style={{ margin: 0 }}>
              Checkpoint uses Ollama to download and run local models. Install it, then click Refresh.
            </p>
            <div>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => appApi.openExternal('https://ollama.com').catch(err => report('open Ollama download page', err))}
              >
                <ExternalLink size={12} aria-hidden="true" />
                Get Ollama
              </button>
            </div>
          </div>
        )}

        {!loadingOllama && ollamaStatus?.installed && !ollamaStatus.running && (
          <div
            style={{
              background: 'var(--color-warning-muted)',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-2)'
            }}
          >
            <span>Ollama is installed but not running. Start Ollama to install or manage models.</span>
          </div>
        )}

        {/* installed models */}
        {localModels.length > 0 && (
          <div className="col-sm">
            <div className="label-caps-sm">Installed on this machine ({localModels.length})</div>
            <div className="row-wrap-6px">
              {localModels.map(m => {
                const isCurrent = activeModel?.toLowerCase() === m.toLowerCase()
                return (
                  <div
                    key={m}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-1-5)',
                      padding: '4px 8px',
                      background: isCurrent ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                      border: `1px solid ${isCurrent ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-xs)'
                    }}
                  >
                    <span className="mono" style={{ color: isCurrent ? 'var(--color-secondary)' : 'var(--color-text-base)' }}>
                      {m}
                    </span>
                    {onUseModel && !isCurrent && (
                      <button
                        type="button"
                        onClick={() => onUseModel(m)}
                        className="btn-ghost"
                        style={{ padding: '1px 5px', fontSize: 'var(--text-2xs)', color: 'var(--color-text-base)' }}
                        title={`Set active provider model to ${m}`}
                      >
                        Use
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteModel(m)}
                      disabled={deletingTag === m}
                      className="btn-ghost hover-text-error"
                      style={{ padding: '2px', display: 'flex' }}
                      aria-label={`Delete ${m}`}
                      title={`Delete ${m}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* search & filter toolbar */}
        <div className="col-sm">
          <div className="row-between-gap" style={{ flexWrap: 'wrap' }}>
            <div className="row-relative" style={{ flex: '1 1 14rem' }}>
              <Search size={13} className="icon-faint" style={{ position: 'absolute', left: '10px', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search local models…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Search local models"
                className="input-base"
                style={{ paddingLeft: '30px', paddingRight: searchQuery ? '28px' : undefined }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn-ghost"
                  style={{ position: 'absolute', right: '4px', padding: '4px' }}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              aria-label="Sort local models"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'fit' | 'params_asc' | 'params_desc')}
              className="select-sm"
              style={{ width: 'auto' }}
            >
              <option value="fit">Best for my hardware</option>
              <option value="params_asc">Smallest first</option>
              <option value="params_desc">Largest first</option>
            </select>
          </div>

          <div className="row-wrap-6px">
            {CAP_FILTERS.map(f => {
              const active = capFilter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCapFilter(f.id)}
                  className="renewal-filter"
                  style={active ? {
                    background: 'var(--color-secondary-muted)',
                    borderColor: 'var(--color-secondary)',
                    color: 'var(--color-secondary)',
                    fontWeight: 'var(--weight-semibold)'
                  } : undefined}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* catalog grid */}
        {filteredModels.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={24} />}
            title={hiddenBySafeMode > 0 ? 'Safe Mode is hiding every match' : 'No models match your search'}
            description={hiddenBySafeMode > 0
              ? `${hiddenBySafeMode} model${hiddenBySafeMode === 1 ? '' : 's'} match, all over ${SAFE_MODE_MAX_PARAMS}B parameters.`
              : 'Try another name, family (e.g. Qwen, Gemma), or capability.'}
            actionLabel={hiddenBySafeMode > 0 ? 'Turn off Safe Mode' : undefined}
            onActionClick={hiddenBySafeMode > 0 ? () => handleToggleSafeMode(false) : undefined}
            style={{
              height: 'auto',
              border: '1px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-2)',
              maxWidth: 'none'
            }}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(270px, 100%), 1fr))',
              gap: 'var(--space-3)'
            }}
          >
            {filteredModels.map((model) => {
              const fitResult = specs ? calculateFitResult(specs, model) : null
              const recommendedQuant = fitResult?.recommendedVariant || 'q4'
              const variant = model.variants[recommendedQuant] ?? Object.values(model.variants)[0]
              if (!variant) return null

              const isInstalled = localModels.some((m) => {
                const normalM = m.toLowerCase().replace(/:latest$/, '')
                const normalTarget = variant.ollamaTag.toLowerCase().replace(/:latest$/, '')
                return normalM === normalTarget || m.toLowerCase() === variant.ollamaTag.toLowerCase()
              })
              const isPullingThis = pullingModelTag === variant.ollamaTag
              const poorFit = fitResult?.status === 'not_recommended'

              let fitColor = 'var(--color-text-muted)'
              let fitBg = 'var(--color-surface-offset)'
              let fitLabel = 'Unavailable'
              if (fitResult) {
                switch (fitResult.status) {
                  case 'optimal': fitColor = 'var(--color-success)'; fitBg = 'var(--color-success-muted)'; fitLabel = 'Optimal Fit'; break
                  case 'tight': fitColor = 'var(--color-warning)'; fitBg = 'var(--color-warning-muted)'; fitLabel = 'Tight Fit'; break
                  case 'cpu_offload': fitColor = 'var(--color-priority-low)'; fitBg = 'rgba(59, 130, 246, 0.12)'; fitLabel = 'CPU Offload'; break
                  case 'not_recommended': fitColor = 'var(--color-error)'; fitBg = 'var(--color-error-muted)'; fitLabel = 'Not Recommended'; break
                }
              }

              return (
                <div
                  key={model.id}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 'var(--space-4)',
                    gap: 'var(--space-3)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 'var(--space-2)' }}>
                    <div className="min-w-0">
                      <span className="text-nano mono">{model.family}</span>
                      <h3 className="heading-sm-strong" style={{ marginTop: '2px' }}>{model.name}</h3>
                    </div>
                    {fitResult && (
                      <span
                        style={{
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 'var(--weight-bold)',
                          color: fitColor,
                          backgroundColor: fitBg,
                          border: `1px solid ${fitColor}`,
                          padding: '1px 7px',
                          borderRadius: 'var(--radius-full)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {fitLabel}
                      </span>
                    )}
                  </div>

                  <p className="text-caption-flush" style={{ lineHeight: 'var(--leading-normal)' }}>
                    {model.description}
                  </p>

                  {model.capabilities && model.capabilities.length > 0 && (
                    <div className="row-wrap-6px">
                      {model.capabilities.map((cap) => {
                        const meta = CAP_META[cap]
                        if (!meta) return null
                        return (
                          <span
                            key={cap}
                            style={{
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 'var(--weight-semibold)',
                              color: meta.color,
                              background: `${meta.color}18`,
                              border: `1px solid ${meta.color}44`,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full)'
                            }}
                          >
                            {meta.label}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  <div className="row-wrap" style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)' }}>
                    <span>{model.parameters < 1 ? `${Math.round(model.parameters * 1000)}M` : `${model.parameters}B`}</span>
                    {model.contextLength ? <span>{formatContext(model.contextLength)}</span> : null}
                    <span>RAM {variant.ramRequiredGb} GB</span>
                    <span>VRAM {variant.vramRequiredGb > 0 ? `${variant.vramRequiredGb} GB` : '—'}</span>
                    <span>{variant.fileSizeGb} GB</span>
                  </div>

                  {fitResult && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div className="row-between" style={{ fontSize: 'var(--text-2xs)' }}>
                        <span className="text-muted">Fit score</span>
                        <span style={{ fontWeight: 'var(--weight-bold)', color: fitColor }}>{fitResult.score}/100</span>
                      </div>
                      <div style={{ background: 'var(--color-surface-offset)', height: '4px', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${fitResult.score}%`, backgroundColor: fitColor }} />
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 'auto' }}>
                    {isPullingThis ? (
                      <div className="col-xs">
                        <div className="row-between" style={{ fontSize: 'var(--text-2xs)' }}>
                          <span className="text-muted">{pullStatusText || 'Downloading…'}</span>
                          <span style={{ fontWeight: 'var(--weight-bold)' }}>{pullPercent}%</span>
                        </div>
                        <div className="row">
                          <div style={{ flex: 1, background: 'var(--color-surface-offset)', height: '6px', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pullPercent}%`, backgroundColor: 'var(--color-primary)', transition: 'width 0.2s linear' }} />
                          </div>
                          <button type="button" onClick={handleAbort} className="btn-secondary btn-small" style={{ color: 'var(--color-error)' }}>
                            <StopCircle size={12} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : pullingModelTag ? (
                      <button type="button" disabled className="btn-secondary" style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
                        Another model is downloading
                      </button>
                    ) : isInstalled ? (
                      <div className="row">
                        <button type="button" disabled className="btn-secondary" style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>
                          <CheckCircle size={13} aria-hidden="true" /> Installed
                        </button>
                        {onUseModel && (
                          <button
                            type="button"
                            className="btn-primary btn-small"
                            onClick={() => onUseModel(variant.ollamaTag)}
                          >
                            Use
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInstall(variant.ollamaTag, poorFit ? fitResult?.reason : undefined)}
                        disabled={ollamaStatus ? !ollamaStatus.running : true}
                        title={ollamaStatus?.running ? `Pull ${variant.ollamaTag}` : 'Ollama is not running'}
                        className={poorFit ? 'btn-secondary' : 'btn-primary'}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 'var(--space-1-5)',
                          fontSize: 'var(--text-xs)',
                          ...(poorFit ? { borderColor: 'var(--color-warning)', color: 'var(--color-warning)' } : {})
                        }}
                      >
                        {poorFit ? <Info size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                        {poorFit ? 'Install anyway' : 'Download & Install'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
