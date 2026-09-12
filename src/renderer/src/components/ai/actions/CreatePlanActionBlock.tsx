import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Sparkles, CheckCircle2, Layout, ArrowRight, Check, FileText, FileDown, X } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { useToast } from '../../ui/Toast'
import type { AiPlanStep } from '../aiActionTypes'
import { asArray, asObject, str } from '../aiActionTypes'
import { faultTolerantParseJSON } from '../aiActionParse'
import { createItem } from '../../../data/items'

export default function CreatePlanActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()

  const parsed = faultTolerantParseJSON(jsonString)

  // Derived with null-safe defaults so every hook below runs unconditionally.
  // The `!parsed` bail-out has to sit *after* the hooks: streaming AI output is
  // routinely unparseable on early renders and only parses once complete, so
  // returning first would change this component's hook count mid-life and make
  // React throw "rendered more hooks than during the previous render".
  //
  // A non-object (the model answered with an array) still renders the plan
  // shell with zero steps; only `null` reaches the bail-out further down.
  const root = asObject(parsed) ?? {}
  // Field-for-field with what the block declares. No alias widening, so a step
  // that rendered blank before still renders blank.
  const planTitle = str(root.title)
  const planOverview = str(root.overview)
  const steps: AiPlanStep[] = asArray(root.steps).map(s => {
    const o = asObject(s) ?? {}
    return { title: str(o.title), details: str(o.details), status: str(o.status) }
  })

  // Stable localStorage key for per-step approval persistence (survives chat reload)
  const planSignature = `checkpoint_plan::${planTitle.replace(/s+/g, '_').slice(0, 40)}::${steps.length}`

  const readStoredApprovals = (sig: string, count: number): boolean[] => {
    try {
      const stored = localStorage.getItem(sig)
      if (stored) {
        const arr = JSON.parse(stored)
        if (Array.isArray(arr) && arr.length === count) return arr
      }
    } catch {}
    return Array.from({ length: count }, () => true) // all approved by default
  }

  const [stepApprovals, setStepApprovals] = useState<boolean[]>(() =>
    readStoredApprovals(planSignature, steps.length)
  )

  const [phase, setPhase] = useState<'review' | 'committed'>(() => {
    try {
      return localStorage.getItem(planSignature + '_committed') === '1' ? 'committed' : 'review'
    } catch {}
    return 'review'
  })

  const [exportedCount, setExportedCount] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  // Those initializers only run on the very first render, which may land before
  // the plan JSON is parseable. Re-read persisted state once the real steps
  // arrive, otherwise the block would stay stuck on the empty-plan defaults.
  useEffect(() => {
    setStepApprovals(prev =>
      prev.length === steps.length ? prev : readStoredApprovals(planSignature, steps.length)
    )
    try {
      setPhase(localStorage.getItem(planSignature + '_committed') === '1' ? 'committed' : 'review')
    } catch {}
  }, [planSignature, steps.length])

  if (!parsed) return <pre>{jsonString}</pre>

  const toggleStep = (idx: number) => {
    if (phase !== 'review') return
    setStepApprovals(prev => {
      const next = [...prev]
      next[idx] = !next[idx]
      try { localStorage.setItem(planSignature, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const approvedSteps = steps.filter((_, i) => stepApprovals[i] !== false)
  const approvedCount = approvedSteps.length
  const skippedCount = steps.length - approvedCount

  const handleCommit = async () => {
    let count = 0
    const context = activeWorkspace || 'default'
    const posBase = Date.now() // ascending positions keep plan order on the board
    for (const step of approvedSteps) {
      try {
        await createItem({
          context, type: 'card',
          title: step.title || 'Plan Step',
          body: step.details || '',
          status: 'open',
          priority: 2,
          position: posBase + count * 10,
          due_at: null, metadata: '{}'
        }, [])
        count++
      } catch (e) { console.warn('Failed to export plan step:', e) }
    }
    setExportedCount(count)
    setPhase('committed')
    try { localStorage.setItem(planSignature + '_committed', '1') } catch {}
    window.dispatchEvent(new CustomEvent('kanban-refresh'))
    toast(`${count} plan step${count !== 1 ? 's' : ''} added to Kanban board!`, { type: 'success' })
  }

  const handleExportMarkdown = async () => {
    let md = `# ${planTitle || 'Implementation Plan'}\n\n`
    if (planOverview) md += `## Overview\n\n${planOverview}\n\n`
    md += `## Steps\n\n`
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const approved = stepApprovals[i] !== false
      md += `- [${approved ? ' ' : 'x'}] **${s.title}**\n${s.details ? `  ${s.details}\n` : ''}\n`
    }
    const success = await window.electronAPI.app.saveFile('implementation_plan.md', md)
    if (success) toast('Implementation plan saved as Markdown!', { type: 'success' })
  }

  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '5px 12px', fontSize: '11px', fontWeight: 'bold',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
  }

  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      margin: '12px 0',
      boxShadow: 'var(--shadow-sm)',
      transition: 'border-color 300ms ease'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: phase === 'committed' ? 'var(--color-success-soft)' : 'var(--color-info)' }}>
          <Sparkles size={14} style={{ flexShrink: 0 }} />
          <span>Implementation Plan</span>
          {phase === 'review' && (
            <span style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', color: '#7dd3fc', fontSize: '9px', padding: '1px 6px', borderRadius: '10px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
              Awaiting Approval
            </span>
          )}
          {phase === 'committed' && (
            <span style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--color-success-soft)', fontSize: '9px', padding: '1px 6px', borderRadius: '10px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
              ✓ Committed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowModal(true)}
            style={{
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: 'var(--color-info)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap'
            }}
          >
            <Layout size={11} /> Expand Plan
          </button>
          {phase === 'review' && (
            <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
              {approvedCount}/{steps.length} approved
            </span>
          )}
          {phase === 'committed' && exportedCount !== null && (
            <span style={{ fontSize: '9px', color: 'var(--color-success-soft)', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
              {exportedCount} card{exportedCount !== 1 ? 's' : ''} created
            </span>
          )}
        </div>
      </div>

      {/* Plan Title + Overview */}
      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f1f5f9', marginBottom: planOverview ? '6px' : '10px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{planTitle}</div>
      {planOverview && (
        <div style={{
          fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.6,
          background: 'rgba(255,255,255,0.03)',
          borderLeft: `2px solid ${phase === 'committed' ? 'rgba(34,197,94,0.4)' : 'rgba(56,189,248,0.4)'}`,
          paddingLeft: '10px', borderRadius: '0 4px 4px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          {planOverview}
        </div>
      )}

      {/* Step List. Phase 1: clickable toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '14px' }}>
        {steps.map((s, idx) => {
          const isApproved = stepApprovals[idx] !== false
          return (
            <div
              key={idx}
              onClick={() => toggleStep(idx)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                background: isApproved ? 'rgba(56,189,248,0.05)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isApproved ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                cursor: phase === 'review' ? 'pointer' : 'default',
                transition: 'all 150ms ease',
                opacity: isApproved ? 1 : 0.45
              }}
            >
              {/* Toggle indicator */}
              <div style={{
                width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginTop: '1px',
                border: `2px solid ${isApproved ? 'var(--color-info)' : 'rgba(255,255,255,0.2)'}`,
                background: isApproved ? 'rgba(56,189,248,0.2)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 150ms ease'
              }}>
                {isApproved && <Check size={10} color="#38bdf8" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '11px', fontWeight: 'bold',
                  color: isApproved ? '#e2e8f0' : '#64748b',
                  textDecoration: isApproved ? 'none' : 'line-through',
                  marginBottom: s.details ? '2px' : '0'
                }}>
                  {s.title}
                </div>
                {s.details && (
                  <div style={{ fontSize: '10px', color: isApproved ? 'var(--color-text-muted)' : 'var(--color-text-faint)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {s.details}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action Buttons */}
      {phase === 'review' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <button
            onClick={handleExportMarkdown}
            style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
          >
            <FileText size={12} style={{ color: 'var(--color-info)' }} />
            <span>Save as .md</span>
          </button>
          <button
            onClick={handleCommit}
            disabled={approvedCount === 0}
            style={{
              ...btnBase,
              background: approvedCount === 0 ? 'rgba(255,255,255,0.05)' : '#0284c7',
              color: approvedCount === 0 ? 'var(--color-text-faint)' : '#fff',
              cursor: approvedCount === 0 ? 'not-allowed' : 'pointer'
            }}
            onMouseEnter={e => { if (approvedCount > 0) (e.currentTarget as HTMLButtonElement).style.background = '#0369a1' }}
            onMouseLeave={e => { if (approvedCount > 0) (e.currentTarget as HTMLButtonElement).style.background = '#0284c7' }}
          >
            <CheckCircle2 size={12} />
            <span>Approve &amp; Export to Kanban ({approvedCount})</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <span style={{ fontSize: '10px', color: '#64748b' }}>
            {skippedCount > 0 ? `${skippedCount} step${skippedCount !== 1 ? 's' : ''} skipped` : 'All steps exported'}
          </span>
          <button
            onClick={() => setView('kanban')}
            style={{ ...btnBase, background: 'var(--color-surface-offset)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-text-base)' }}
          >
            <Layout size={12} />
            <span>View on Kanban</span>
            <ArrowRight size={11} />
          </button>
        </div>
      )}

      {/* Modal Overlay detail view */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(10, 12, 18, 0.85)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px', boxSizing: 'border-box'
        }}>
          <style>{`
            .plan-markdown-body {
              font-size: 11px;
              line-height: 1.5;
              color: var(--color-text-muted);
              white-space: normal;
              word-break: break-word;
            }
            .plan-markdown-body p {
              margin: 0 0 6px 0;
              white-space: normal;
              word-break: break-word;
            }
            .plan-markdown-body p:last-child {
              margin-bottom: 0;
            }
            .plan-markdown-body ul, .plan-markdown-body ol {
              margin: 2px 0 6px 0;
              padding-left: 16px;
            }
            .plan-markdown-body li {
              margin-bottom: 3px;
            }
            .plan-markdown-body li > p {
              margin: 0;
              display: inline;
            }
            .plan-markdown-body li::marker {
              color: var(--color-secondary);
            }
            .plan-markdown-body strong, .plan-markdown-body b {
              color: var(--color-text-base);
              font-weight: bold;
            }
            .plan-markdown-body blockquote {
              border-left: 3px solid var(--color-secondary);
              background: var(--color-surface-offset);
              margin: 8px 0;
              padding: 6px 10px;
              color: var(--color-text-muted);
              font-style: italic;
              border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
            }
            .plan-markdown-body code {
              background: var(--color-surface-offset);
              color: var(--color-text-base);
              padding: 2px 4px;
              border-radius: var(--radius-sm);
              font-family: var(--font-mono);
              font-size: 10px;
            }
          `}</style>
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '1000px', height: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)', overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Sparkles size={16} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', letterSpacing: '-0.01em' }}>
                  Plan Review: {planTitle}
                </span>
              </div>
              <button onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 150ms' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-base)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Left Column: Steps list */}
              <div style={{
                width: '320px', borderRight: '1px solid var(--color-surface-offset)',
                overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '18px', background: 'var(--color-surface-1)', flexShrink: 0
              }}>
                <div style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.08em' }}>
                  Steps Checklist ({approvedCount}/{steps.length} approved)
                </div>
                {steps.map((s, idx) => {
                  const isApproved = stepApprovals[idx] !== false
                  const isSelected = activeStepIndex === idx
                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveStepIndex(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        background: isSelected ? 'var(--color-surface-offset)' : 'transparent',
                        borderLeft: `3px solid ${isSelected ? 'var(--color-secondary)' : 'transparent'}`,
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        padding: '10px 14px 10px 10px',
                        cursor: 'pointer', transition: 'all 150ms ease',
                        marginBottom: '2px'
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) e.currentTarget.style.background = 'var(--color-surface-offset)'
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {/* Round Checkbox indicator */}
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleStep(idx) }}
                        style={{
                          width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${isApproved ? 'var(--color-success)' : 'var(--color-text-faint)'}`,
                          background: isApproved ? 'var(--color-success)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 150ms ease',
                          cursor: 'pointer'
                        }}
                        title={isApproved ? "Click to Skip step" : "Click to Approve step"}
                      >
                        {isApproved && <Check size={10} color="#fff" strokeWidth={3} />}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: isSelected ? 'var(--color-secondary)' : 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                          Step 0{idx + 1}
                        </span>
                        <span style={{
                          fontSize: '11px', fontWeight: isSelected ? 'bold' : 'normal',
                          color: isApproved ? (isSelected ? 'var(--color-text-base)' : 'var(--color-text-muted)') : 'var(--color-text-faint)',
                          textDecoration: isApproved ? 'none' : 'line-through',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                          {s.title}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Right Column: Step details */}
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '32px', background: 'var(--color-surface-2)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {steps[activeStepIndex] ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                          STEP DETAILS • 0{activeStepIndex + 1} OF {steps.length}
                        </span>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-text-base)', letterSpacing: '-0.01em' }}>
                          {steps[activeStepIndex].title}
                        </h2>
                      </div>
                      <button
                        onClick={() => toggleStep(activeStepIndex)}
                        style={{
                          background: stepApprovals[activeStepIndex] !== false ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          border: `1px solid ${stepApprovals[activeStepIndex] !== false ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                          color: stepApprovals[activeStepIndex] !== false ? 'var(--color-success-soft)' : '#f87171',
                          borderRadius: '20px', padding: '6px 14px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 150ms ease'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: stepApprovals[activeStepIndex] !== false ? '#22c55e' : '#ef4444' }} />
                        {stepApprovals[activeStepIndex] !== false ? 'Approved' : 'Skipped'}
                      </button>
                    </div>

                    <div className="plan-markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={url => url}
                      >
                        {steps[activeStepIndex].details || '*No details provided for this step.*'}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-faint)', fontSize: '12px' }}>
                    Select a step on the left to see details
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexShrink: 0
            }}>
              {phase === 'review' ? (
                <>
                  <button
                    onClick={handleExportMarkdown}
                    style={{
                      ...btnBase,
                      background: 'var(--color-surface-offset)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'opacity 150ms ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    <FileDown size={13} /> Save as .md
                  </button>
                  <button
                    onClick={() => { handleCommit(); setShowModal(false) }}
                    style={{
                      ...btnBase,
                      background: 'var(--color-secondary)',
                      color: 'var(--color-text-inverted)',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'opacity 150ms ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    <CheckCircle2 size={13} /> Approve &amp; Export to Kanban ({approvedCount})
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    ...btnBase,
                    background: 'var(--color-surface-offset)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'opacity 150ms ease'
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
