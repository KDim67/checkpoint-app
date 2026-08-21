import React, { useState, useEffect, useRef } from 'react'
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
  Sparkles
} from 'lucide-react'
import catalogData from '../../../shared/catalog.json'
import { calculateFitResult } from '../../../shared/scoreEngine'
import type { CatalogModel, HardwareSpecs, OllamaStatus, PullProgressEvent } from '../../../shared/cookbookTypes'
import Skeleton from './ui/Skeleton'
import EmptyState from './ui/EmptyState'
import { useToast } from './ui/Toast'
import { useConfirm } from './ui/ConfirmDialog'

// Capability filters + display metadata for badges.
const CAP_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'code', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'vision', label: 'Vision' },
  { id: 'tools', label: 'Tools' },
  { id: 'embedding', label: 'Embedding' },
  { id: 'tiny', label: 'Tiny ≤3B' }
]

const CAP_META: Record<string, { label: string; color: string }> = {
  code:      { label: 'Code',      color: '#3b82f6' },
  reasoning: { label: 'Reasoning', color: '#a855f7' },
  vision:    { label: 'Vision',    color: '#ec4899' },
  tools:     { label: 'Tools',     color: '#22c55e' },
  chat:      { label: 'Chat',      color: '#64748b' },
  embedding: { label: 'Embedding', color: '#f59e0b' }
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  if (tokens >= 1000) return `${Math.round(tokens / 1024)}K ctx`
  return `${tokens} ctx`
}

export default function CookbookView() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [searchQuery, setSearchQuery] = useState('')
  const [capFilter, setCapFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'fit' | 'params_asc' | 'params_desc'>('fit')
  const [deletingTag, setDeletingTag] = useState<string | null>(null)
  const [specs, setSpecs] = useState<HardwareSpecs | null>(null)
  const [loadingSpecs, setLoadingSpecs] = useState(true)

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [loadingOllama, setLoadingOllama] = useState(true)

  const [unitySafeMode, setUnitySafeMode] = useState(false)

  // Active pull state tracking
  const [pullingModelTag, setPullingModelTag] = useState<string | null>(null)
  const pullingModelTagRef = useRef<string | null>(null)
  const [pullPercent, setPullPercent] = useState(0)
  const [pullStatusText, setPullStatusText] = useState('')
  const [pullError, setPullError] = useState<string | null>(null)

  const updatePullingModel = (tag: string | null) => {
    setPullingModelTag(tag)
    pullingModelTagRef.current = tag
  }

  const loadHardwareSpecs = async () => {
    setLoadingSpecs(true)
    try {
      const hardwareSpecs = await window.electronAPI.cookbook.getHardwareSpecs()
      setSpecs(hardwareSpecs)
    } catch (err) {
      console.error('Failed to load hardware specs:', err)
    } finally {
      setLoadingSpecs(false)
    }
  }

  const loadOllamaStatus = async () => {
    setLoadingOllama(true)
    try {
      const status = await window.electronAPI.cookbook.checkOllama()
      setOllamaStatus(status)
    } catch (err) {
      console.error('Failed to check Ollama status:', err)
    } finally {
      setLoadingOllama(false)
    }
  }

  // Initial load
  useEffect(() => {
    loadHardwareSpecs()
    loadOllamaStatus()

    const loadSafeModeSetting = async () => {
      try {
        const val = await window.electronAPI.db.getSetting('unitySafeMode')
        if (val !== null && val !== undefined) {
          setUnitySafeMode(val === true || val === 'true')
        }
      } catch (err) {
        console.error('Failed to load unitySafeMode setting:', err)
      }
    }
    loadSafeModeSetting()
  }, [])

  // Listen for IPC pull progress events
  useEffect(() => {
    const unsubscribeProgress = window.electronAPI.cookbook.onPullProgress((event: PullProgressEvent) => {
      updatePullingModel(event.modelId)
      setPullPercent(event.percent >= 0 ? event.percent : 0)
      setPullStatusText(event.status)
      setPullError(null)
    })

    const cleanDone = window.electronAPI.cookbook.onPullDone(() => {
      const tag = pullingModelTagRef.current
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
      setPullError(null)
      loadOllamaStatus()
      if (tag) {
        toast(`Model "${tag}" installed successfully!`, { type: 'success' })
      }
    })

    const cleanError = window.electronAPI.cookbook.onPullError((data: { modelTag: string; message: string }) => {
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
      setPullError(data.message)
      toast(`Failed to install model "${data.modelTag}": ${data.message}`, { type: 'error' })
    })

    return () => {
      unsubscribeProgress()
      cleanDone()
      cleanError()
    }
  }, [])

  const handleToggleSafeMode = async (newValue: boolean) => {
    setUnitySafeMode(newValue)
    try {
      await window.electronAPI.db.setSetting('unitySafeMode', newValue)
    } catch (err) {
      console.error('Failed to save unitySafeMode setting:', err)
    }
  }

  const handleInstall = async (modelTag: string) => {
    setPullError(null)
    updatePullingModel(modelTag)
    setPullPercent(0)
    setPullStatusText('Connecting to Ollama...')
    try {
      await window.electronAPI.cookbook.pullModel(modelTag)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setPullError(errMsg)
      updatePullingModel(null)
    }
  }

  const handleAbort = async () => {
    const tag = pullingModelTagRef.current
    try {
      await window.electronAPI.cookbook.stopPull()
      if (tag) {
        toast(`Pull of "${tag}" canceled.`)
      }
    } catch (err) {
      console.error('Failed to abort pull:', err)
    } finally {
      updatePullingModel(null)
      setPullPercent(0)
      setPullStatusText('')
    }
  }

  const handleOpenExternal = async (url: string) => {
    try {
      await window.electronAPI.app.openExternal(url)
    } catch (err) {
      console.error('Failed to open URL:', err)
    }
  }

  const handleDeleteModel = async (modelTag: string) => {
    const ok = await confirm({
      title: 'Delete model',
      message: `Delete "${modelTag}" from your machine? You can always reinstall it later.`,
      confirmText: 'Delete',
      isDestructive: true
    })
    if (!ok) return
    setDeletingTag(modelTag)
    try {
      const ok = await window.electronAPI.cookbook.deleteModel(modelTag)
      if (ok) {
        toast(`Removed "${modelTag}"`, { type: 'success' })
        await loadOllamaStatus()
      } else {
        toast(`Could not remove "${modelTag}"`, { type: 'error' })
      }
    } catch (err) {
      console.error('Failed to delete model:', err)
      toast('Failed to remove model', { type: 'error' })
    } finally {
      setDeletingTag(null)
    }
  }

  const catalogModels: CatalogModel[] = catalogData as CatalogModel[]
  const filteredModels = catalogModels
    .filter((m) => {
      if (unitySafeMode && m.parameters > 4) return false
      if (capFilter === 'tiny') {
        if (m.parameters > 3) return false
      } else if (capFilter !== 'all') {
        if (!m.capabilities?.includes(capFilter as never)) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchName = m.name.toLowerCase().includes(q)
        const matchDesc = m.description.toLowerCase().includes(q)
        const matchFamily = m.family.toLowerCase().includes(q)
        const matchUseCases = m.useCases.some(uc => uc.toLowerCase().includes(q))
        const matchCaps = (m.capabilities || []).some(c => c.toLowerCase().includes(q))
        if (!matchName && !matchDesc && !matchFamily && !matchUseCases && !matchCaps) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'params_asc') return a.parameters - b.parameters
      if (sortBy === 'params_desc') return b.parameters - a.parameters
      // 'fit' (default): best hardware fit first, then smaller models
      const fa = specs ? calculateFitResult(specs, a).score : 0
      const fb = specs ? calculateFitResult(specs, b).score : 0
      if (fb !== fa) return fb - fa
      return a.parameters - b.parameters
    })

  const localModels = ollamaStatus?.localModels || []

  return (
    <div
      style={{
        padding: 'var(--space-6)',
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)'
      }}
    >
      {/* Title Header */}
      <div>
        <h1
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            letterSpacing: 'var(--tracking-tight)',
            marginBottom: 'var(--space-1)',
            color: 'var(--color-text-base)'
          }}
        >
          AI Cookbook
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Discover, optimize, and install local models tailored for your workstation hardware.
        </p>
      </div>

      {/* Specs Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
          gap: 'var(--space-4)'
        }}
      >
        {loadingSpecs ? (
          <>
            <Skeleton height={88} borderRadius="var(--radius-lg)" />
            <Skeleton height={88} borderRadius="var(--radius-lg)" />
            <Skeleton height={88} borderRadius="var(--radius-lg)" />
          </>
        ) : specs ? (
          <>
            {/* CPU Spec Panel */}
            <div
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'none'
              }}
            >
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--color-surface-2)',
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-surface-offset)'
                }}
              >
                <Cpu size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-muted)',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase'
                  }}
                >
                  CPU PROFILER
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--color-text-base)',
                    marginTop: 'var(--space-1)'
                  }}
                >
                  {specs.cpuCores} Cores / {specs.cpuThreads} Threads
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                  Platform: {specs.platform}
                </div>
              </div>
            </div>

            {/* RAM Spec Panel */}
            <div
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'none'
              }}
            >
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--color-surface-2)',
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-surface-offset)'
                }}
              >
                <Database size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-muted)',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase'
                  }}
                >
                  SYSTEM RAM
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--color-text-base)',
                    marginTop: 'var(--space-1)'
                  }}
                >
                  {specs.ramGb.toFixed(1)} GB Installed
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                  App Limit: {(specs.ramGb * 0.75).toFixed(1)} GB (75% Max)
                </div>
              </div>
            </div>

            {/* GPU Spec Panel */}
            <div
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'none'
              }}
            >
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--color-surface-2)',
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-surface-offset)'
                }}
              >
                <Layers size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-text-muted)',
                    letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase'
                  }}
                >
                  GRAPHICS SPEC
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--color-text-base)',
                    marginTop: 'var(--space-1)',
                    maxWidth: '220px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={specs.gpuName || 'Unknown GPU'}
                >
                  {specs.gpuName || 'No GPU Detected'}
                </div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                  {specs.vramGb > 0
                    ? `${specs.vramGb.toFixed(1)} GB VRAM (${specs.gpuVendor.toUpperCase()})`
                    : 'Using system RAM (CPU only)'}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              gridColumn: '1 / -1'
            }}
          >
            Failed to gather system specifications.
          </div>
        )}
      </div>

      {/* Control and Toggle Bar */}
      <div
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4) var(--space-5)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          boxShadow: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1 }}>
          <button
            onClick={() => handleToggleSafeMode(!unitySafeMode)}
            style={{
              position: 'relative',
              display: 'inline-flex',
              height: '24px',
              width: '44px',
              alignItems: 'center',
              borderRadius: '9999px',
              transition: 'background-color 200ms var(--ease-default)',
              backgroundColor: unitySafeMode ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
              border: '1px solid var(--color-surface-offset)',
              cursor: 'pointer',
              outline: 'none',
              padding: 0
            }}
          >
            <span
              style={{
                display: 'inline-block',
                height: '16px',
                width: '16px',
                borderRadius: '50%',
                transition: 'transform 200ms var(--ease-default), background-color 200ms var(--ease-default)',
                transform: unitySafeMode ? 'translateX(24px)' : 'translateX(4px)',
                backgroundColor: unitySafeMode ? 'var(--color-text-inverted)' : 'var(--color-text-muted)'
              }}
            />
          </button>
          <div>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-base)'
              }}
            >
              Unity-Safe Mode
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Filters out models larger than 4B parameters to prevent VRAM competition with the Unity Editor.
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            loadHardwareSpecs()
            loadOllamaStatus()
          }}
          disabled={loadingSpecs || loadingOllama}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            color: 'var(--color-text-base)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--weight-medium)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            cursor: 'pointer',
            opacity: loadingSpecs || loadingOllama ? 0.6 : 1
          }}
        >
          <RefreshCw size={14} className={loadingSpecs || loadingOllama ? 'animate-spin' : ''} />
          Refresh Status
        </button>
      </div>

      {/* Pulling Error Banner */}
      {pullError && (
        <div
          style={{
            background: 'var(--color-error-muted)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            color: 'var(--color-text-base)',
            fontSize: 'var(--text-xs)',
            display: 'flex',
            alignItems: 'start',
            gap: 'var(--space-3)'
          }}
        >
          <AlertTriangle size={16} style={{ color: 'var(--color-error)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)' }}>
              Model Installation Error
            </div>
            <div>{pullError}</div>
          </div>
        </div>
      )}

      {/* Ollama Not Installed Banner */}
      {!loadingOllama && ollamaStatus && !ollamaStatus.installed && (
        <div
          style={{
            background: 'var(--color-error-muted)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} />
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              Ollama Not Detected
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 'var(--leading-normal)' }}>
            Ollama is required to manage local LLM downloads and execution. Install the official Ollama desktop utility to proceed.
          </p>
          <button
            onClick={() => handleOpenExternal(ollamaStatus.downloadUrl)}
            style={{
              alignSelf: 'start',
              background: 'var(--color-primary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              color: '#ffffff',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              cursor: 'pointer'
            }}
          >
            <ExternalLink size={14} />
            Download Ollama
          </button>
        </div>
      )}

      {/* Ollama Installed but not running */}
      {!loadingOllama && ollamaStatus && ollamaStatus.installed && !ollamaStatus.running && (
        <div
          style={{
            background: 'var(--color-warning-muted)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <AlertTriangle size={20} style={{ color: 'var(--color-warning)' }} />
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)' }}>
              Ollama Service Stopped
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 'var(--leading-normal)' }}>
            The Ollama CLI was found, but the server is not listening on http://localhost:11434. Start the Ollama application from your system tray or application list, then click refresh.
          </p>
          <button
            onClick={loadOllamaStatus}
            style={{
              alignSelf: 'start',
              background: 'var(--color-warning)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              color: '#000000',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-medium)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} />
            Reconnect Now
          </button>
        </div>
      )}

      {/* Installed models management */}
      {localModels.length > 0 && (
        <div>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-base)', margin: '0 0 var(--space-3)' }}>
            Installed Models ({localModels.length})
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {localModels.map(m => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface-1)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>
                <CheckCircle size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontFamily: 'var(--font-mono)' }}>{m}</span>
                <button
                  onClick={() => handleDeleteModel(m)}
                  disabled={deletingTag === m}
                  title="Delete model"
                  aria-label={`Delete ${m}`}
                  style={{ background: 'transparent', border: 'none', color: deletingTag === m ? 'var(--color-text-faint)' : 'var(--color-text-muted)', cursor: deletingTag === m ? 'default' : 'pointer', display: 'flex', padding: '2px' }}
                  onMouseEnter={e => { if (deletingTag !== m) e.currentTarget.style.color = 'var(--color-error)' }}
                  onMouseLeave={e => { if (deletingTag !== m) e.currentTarget.style.color = 'var(--color-text-muted)' }}
                >
                  {deletingTag === m ? <RefreshCw size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Catalog List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <h2
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-base)',
              margin: 0
            }}
          >
            Workstation Model Catalog
          </h2>
          {/* Search Input */}
          <div style={{ position: 'relative', width: '240px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)' }} />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-base"
              style={{
                paddingLeft: '32px',
                height: '32px',
                fontSize: 'var(--text-xs)'
              }}
            />
          </div>
        </div>

        {/* Capability filters + sort */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {CAP_FILTERS.map(f => {
              const active = capFilter === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => setCapFilter(f.id)}
                  style={{
                    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', padding: '4px 10px',
                    borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    background: active ? 'var(--color-primary)' : 'var(--color-surface-2)',
                    color: active ? '#fff' : 'var(--color-text-muted)',
                    border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-surface-offset)'}`
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>{filteredModels.length} models</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'fit' | 'params_asc' | 'params_desc')}
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-text-base)', borderRadius: 'var(--radius-md)', padding: '5px 8px', fontSize: 'var(--text-2xs)', cursor: 'pointer' }}
            >
              <option value="fit">Best for my hardware</option>
              <option value="params_asc">Smallest first</option>
              <option value="params_desc">Largest first</option>
            </select>
          </div>
        </div>

        {filteredModels.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={28} />}
            title="No models match your search"
            description="Try a different name, family (e.g. Llama, Mistral) or use case."
            style={{
              height: 'auto',
              border: '1px dashed var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-surface-1)',
              maxWidth: 'none'
            }}
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))',
              gap: 'var(--space-4)'
            }}
          >
          {filteredModels.map((model) => {
            const fitResult = specs ? calculateFitResult(specs, model) : null
            const recommendedQuant = fitResult?.recommendedVariant || 'q4'
            const variant = model.variants[recommendedQuant] ?? Object.values(model.variants)[0]
            if (!variant) return null

            // Check if installed
            const isInstalled = localModels.some((m) => {
              const normalM = m.toLowerCase().replace(/:latest$/, '')
              const normalTarget = variant.ollamaTag.toLowerCase().replace(/:latest$/, '')
              return normalM === normalTarget || m.toLowerCase() === variant.ollamaTag.toLowerCase()
            })

            const isPullingThis = pullingModelTag === variant.ollamaTag

            // Determine Fit Colors and Labels
            let fitColor = 'var(--color-text-muted)'
            let fitBg = 'var(--color-surface-offset)'
            let fitLabel = 'Unavailable'

            if (fitResult) {
              switch (fitResult.status) {
                case 'optimal':
                  fitColor = 'var(--color-success)'
                  fitBg = 'var(--color-success-muted)'
                  fitLabel = 'Optimal Fit'
                  break
                case 'tight':
                  fitColor = 'var(--color-warning)'
                  fitBg = 'var(--color-warning-muted)'
                  fitLabel = 'Tight Fit'
                  break
                case 'cpu_offload':
                  fitColor = 'var(--color-priority-low)'
                  fitBg = 'rgba(59, 130, 246, 0.12)'
                  fitLabel = 'CPU Offload'
                  break
                case 'not_recommended':
                  fitColor = 'var(--color-error)'
                  fitBg = 'var(--color-error-muted)'
                  fitLabel = 'Not Recommended'
                  break
              }
            }

            return (
              <div
                key={model.id}
                style={{
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 'var(--space-5)',
                  gap: 'var(--space-4)',
                  boxShadow: 'none'
                }}
              >
                {/* Header info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <span
                      style={{
                        fontSize: 'var(--text-2xs)',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)'
                      }}
                    >
                      {model.family}
                    </span>
                    <h3
                      style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-text-base)',
                        marginTop: 'var(--space-2)'
                      }}
                    >
                      {model.name}
                    </h3>
                  </div>

                  {fitResult && (
                    <span
                      style={{
                        fontSize: 'var(--text-2xs)',
                        fontWeight: 'var(--weight-bold)',
                        color: fitColor,
                        backgroundColor: fitBg,
                        border: `1px solid ${fitColor}`,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)'
                      }}
                    >
                      {fitLabel}
                    </span>
                  )}
                </div>

                {/* Description */}
                <p
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    lineHeight: 'var(--leading-normal)',
                    minHeight: '40px'
                  }}
                >
                  {model.description}
                </p>

                {/* Capability badges */}
                {model.capabilities && model.capabilities.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)' }}>
                    {model.capabilities.map((cap) => {
                      const meta = CAP_META[cap]
                      if (!meta) return null
                      return (
                        <span
                          key={cap}
                          style={{
                            fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)',
                            color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}44`,
                            padding: '1px 7px', borderRadius: 'var(--radius-full)'
                          }}
                        >
                          {meta.label}
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Meta line: params · context · license */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)' }}>
                  <span>{model.parameters < 1 ? `${Math.round(model.parameters * 1000)}M` : `${model.parameters}B`} params</span>
                  {model.contextLength ? <span>{formatContext(model.contextLength)}</span> : null}
                  {model.license ? <span>{model.license}</span> : null}
                </div>

                {/* Score bar */}
                {fitResult && (
                  <div
                    style={{
                      border: '1px solid var(--color-surface-offset)',
                      background: 'var(--color-surface-2)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 'var(--space-2)',
                        fontSize: 'var(--text-2xs)'
                      }}
                    >
                      <span style={{ color: 'var(--color-text-muted)' }}>Compatibility Score</span>
                      <span style={{ fontWeight: 'var(--weight-bold)', color: fitColor }}>
                        {fitResult.score} / 100
                      </span>
                    </div>
                    {/* Progress Bar background */}
                    <div
                      style={{
                        background: 'var(--color-surface-offset)',
                        height: '4px',
                        borderRadius: 'var(--radius-full)',
                        overflow: 'hidden',
                        marginBottom: 'var(--space-2)'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${fitResult.score}%`,
                          backgroundColor: fitColor,
                          transition: 'width 0.4s var(--ease-default)'
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-2xs)',
                        color: 'var(--color-text-muted)',
                        lineHeight: 'var(--leading-snug)'
                      }}
                    >
                      {fitResult.reason}
                    </div>
                  </div>
                )}

                {/* Variant resource specs */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-2xs)',
                    textAlign: 'center',
                    borderTop: '1px solid var(--color-surface-offset)',
                    borderBottom: '1px solid var(--color-surface-offset)',
                    padding: 'var(--space-3) 0'
                  }}
                >
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>RAM Req</div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', marginTop: '2px' }}>
                      {variant.ramRequiredGb} GB
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>VRAM Req</div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', marginTop: '2px' }}>
                      {variant.vramRequiredGb > 0 ? `${variant.vramRequiredGb} GB` : 'None'}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)' }}>Disk Size</div>
                    <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)', marginTop: '2px' }}>
                      {variant.fileSizeGb} GB
                    </div>
                  </div>
                </div>

                {/* Footer details & Action buttons */}
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 'var(--text-2xs)'
                    }}
                  >
                    <span style={{ color: 'var(--color-text-muted)' }}>Recommended Quant:</span>
                    <span
                      style={{
                        fontWeight: 'var(--weight-semibold)',
                        color: 'var(--color-text-base)',
                        textTransform: 'uppercase'
                      }}
                    >
                      {recommendedQuant}
                    </span>
                  </div>

                  {/* Actions Area */}
                  {isPullingThis ? (
                    /* Active Pull Status */
                    <div className="col">
                      <div className="row-between">
                        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                          {pullStatusText || 'Downloading...'}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-primary)' }}>
                          {pullPercent}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <div
                          style={{
                            flex: 1,
                            background: 'var(--color-surface-offset)',
                            height: '8px',
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${pullPercent}%`,
                              backgroundColor: 'var(--color-primary)',
                              transition: 'width 0.2s linear'
                            }}
                          />
                        </div>
                        <button
                          onClick={handleAbort}
                          style={{
                            background: 'var(--color-surface-2)',
                            border: '1px solid var(--color-surface-offset)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-1) var(--space-2)',
                            color: 'var(--color-error)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-1)',
                            cursor: 'pointer',
                            fontSize: 'var(--text-2xs)'
                          }}
                          title="Cancel Download"
                        >
                          <StopCircle size={12} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : pullingModelTag ? (
                    /* Queue Locked / Installer Busy */
                    <button
                      disabled
                      style={{
                        width: '100%',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2)',
                        color: 'var(--color-text-faint)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      Queue Locked
                    </button>
                  ) : isInstalled ? (
                    /* Already Installed */
                    <button
                      disabled
                      style={{
                        width: '100%',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2)',
                        color: 'var(--color-success)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      <CheckCircle size={14} />
                      Installed
                    </button>
                  ) : fitResult?.status === 'not_recommended' ? (
                    /* Hardware Insufficient */
                    <button
                      disabled
                      style={{
                        width: '100%',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2)',
                        color: 'var(--color-text-faint)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      <Info size={14} />
                      Hardware Insufficient
                    </button>
                  ) : (
                    /* Download / Install Button */
                    <button
                      onClick={() => handleInstall(variant.ollamaTag)}
                      disabled={ollamaStatus ? !ollamaStatus.running : true}
                      style={{
                        width: '100%',
                        background: 'var(--color-primary)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2)',
                        color: '#ffffff',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-2)',
                        opacity: ollamaStatus?.running ? 1 : 0.6
                      }}
                    >
                      <Download size={14} />
                      Download & Install
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        )}
      </div>
    </div>
  )
}
