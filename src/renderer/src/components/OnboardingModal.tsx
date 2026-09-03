/**
 * The first-run panel.
 *
 * Checkpoint opens onto fourteen views and around thirty services with nothing
 * to orient a new user, and its two best features, the command palette and
 * quick capture, are invisible unless you already know the keys. That is the
 * problem this solves; it is not a feature tour.
 *
 * Three steps rather than one panel, because the useful content splits cleanly
 * into "what is this", "make something", and "how to move quickly", and a
 * single screen carrying all three reads as a wall. Every step can be left via
 * Skip or Escape, and leaving marks it seen, an onboarding that reappears is
 * worse than one that was dismissed too early, and Settings can replay it.
 *
 * Motion, spacing and colour all come from the token system; the modal reuses
 * the same pop-in the rest of the app's dialogs use, and the global
 * prefers-reduced-motion rule in index.css already neutralises it.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Command, Zap, ClipboardList, Check, ArrowRight, ArrowLeft } from 'lucide-react'
import ModalShell from './ui/ModalShell'
import { PROJECT_TEMPLATES, DEFAULT_TEMPLATE_ID, describeTemplate } from '../../../shared/projectTemplates'

/** The three global keys. Kept here as data so the list stays scannable. */
const KEYS: { combo: string; name: string; why: string; icon: React.ReactNode }[] = [
  {
    combo: 'Ctrl + K',
    name: 'Command palette',
    why: 'Reach any view or action by name. The fastest way around the app.',
    icon: <Command size={15} />
  },
  {
    combo: 'Ctrl + Shift + Space',
    name: 'Quick capture',
    why: 'Jot a task from anywhere without leaving what you are doing.',
    icon: <Zap size={15} />
  },
  {
    combo: 'Ctrl + Shift + V',
    name: 'Clipboard history',
    why: 'Everything you have copied, searchable.',
    icon: <ClipboardList size={15} />
  }
]

const TOTAL_STEPS = 3

interface Props {
  /** Creates the workspace and returns once it exists. */
  onCreateWorkspace: (name: string, templateId: string) => Promise<void>
  /** Called on finish or skip; the caller persists that it has been seen. */
  onClose: () => void
}

export default function OnboardingModal({ onCreateWorkspace, onClose }: Props) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // Focus follows the step, so the keyboard path never dead-ends on a panel
  // with nothing focused.
  useEffect(() => {
    if (step === 2) nameRef.current?.focus()
  }, [step])

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setError('')
    try {
      await onCreateWorkspace(trimmed, templateId)
      setStep(3)
    } catch (err) {
      // Recovery path rather than a dead end: the name is still in the field
      // and the button is live again.
      setError(err instanceof Error ? err.message : 'Could not create the workspace. Try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <ModalShell label="Welcome to Checkpoint" onClose={onClose} width="520px" closeOnBackdrop={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* Step indicator */}
        <div
          role="group"
          aria-label={`Step ${step} of ${TOTAL_STEPS}`}
          style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
            <span
              key={n}
              aria-hidden="true"
              style={{
                height: '3px',
                flex: 1,
                borderRadius: '2px',
                background: n <= step ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                transition: `background var(--duration-normal) var(--ease-default)`
              }}
            />
          ))}
        </div>

        {/* 1. What this is */}
        {step === 1 && (
          <>
            <div>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-base)',
                marginBottom: 'var(--space-2)'
              }}>
                Welcome to Checkpoint
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                A board, a backlog, notes, a focus timer, clipboard history and an AI assistant, 
                in one place, organised by workspace.
              </p>
            </div>

            {/* The thing most people want to know first about a local app. */}
            <div style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
              padding: 'var(--space-3)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)'
            }}>
              <Check size={15} style={{ color: 'var(--color-secondary)', flexShrink: 0, marginTop: '2px' }} />
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                Everything stays on this machine. No account, no cloud, no sign-in, 
                your data is a file you own.
              </span>
            </div>
          </>
        )}

        {/* 2. First workspace */}
        {step === 2 && (
          <>
            <div>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-base)',
                marginBottom: 'var(--space-2)'
              }}>
                What are you working on?
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                A workspace keeps one project&apos;s board, notes and tasks together.
                You can add more later.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <label
                htmlFor="onboarding-workspace-name"
                style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}
              >
                Workspace name
              </label>
              <input
                id="onboarding-workspace-name"
                ref={nameRef}
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="e.g. Unity Project"
                style={{
                  background: 'var(--color-surface-1)',
                  border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-surface-offset)'}`,
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none'
                }}
              />
              {/* Errors sit with the field they belong to, and announce themselves. */}
              {error && (
                <span role="alert" style={{ fontSize: '11px', color: 'var(--color-error)' }}>
                  {error}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                Start from
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '176px', overflowY: 'auto' }}>
                {PROJECT_TEMPLATES.map(t => {
                  const selected = templateId === t.id
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={selected}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 'var(--space-3)',
                        textAlign: 'left',
                        background: selected ? 'var(--color-surface-offset)' : 'var(--color-surface-1)',
                        border: `1px solid ${selected ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                        cursor: 'pointer',
                        width: '100%'
                      }}
                    >
                      <span style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 'var(--weight-medium)',
                        color: 'var(--color-text-base)'
                      }}>
                        {t.name}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {describeTemplate(t)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* 3. The keys */}
        {step === 3 && (
          <>
            <div>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-text-base)',
                marginBottom: 'var(--space-2)'
              }}>
                Three keys worth knowing
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                These work from anywhere, even when Checkpoint is in the background.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {KEYS.map(k => (
                <div
                  key={k.combo}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    alignItems: 'flex-start',
                    padding: 'var(--space-3)',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)'
                  }}
                >
                  <span style={{ color: 'var(--color-secondary)', flexShrink: 0, marginTop: '2px' }}>
                    {k.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
                        {k.name}
                      </span>
                      <kbd style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-surface-offset)',
                        border: '1px solid var(--color-surface-elevated)',
                        borderRadius: '4px',
                        padding: '1px 6px'
                      }}>
                        {k.combo}
                      </kbd>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
                      {k.why}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
              All rebindable in Settings, along with everything else. You can reopen this from
              Settings &rarr; About.
            </span>
          </>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
          <button
            className="btn-ghost"
            onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
            disabled={creating}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: 'var(--text-xs)',
              opacity: creating ? 0.5 : 1
            }}
          >
            {step === 1 ? 'Skip' : <><ArrowLeft size={13} /> Back</>}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {step === 2 && (
              <button
                className="btn-ghost"
                onClick={() => setStep(3)}
                disabled={creating}
                style={{ fontSize: 'var(--text-xs)', opacity: creating ? 0.5 : 1 }}
              >
                Not now
              </button>
            )}

            {step === 1 && (
              <button
                className="btn-primary"
                onClick={() => setStep(2)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                Get started <ArrowRight size={13} />
              </button>
            )}

            {step === 2 && (
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: 'var(--text-xs)',
                  opacity: creating || !name.trim() ? 0.5 : 1,
                  cursor: creating || !name.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                {creating ? 'Creating…' : <>Create workspace <ArrowRight size={13} /></>}
              </button>
            )}

            {step === 3 && (
              <button
                className="btn-primary"
                onClick={onClose}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                <Check size={13} /> Done
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  )
}
