/** spotlights the real element where it can, centred otherwise; survives hidden nav items and resizes */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Command, Compass, Zap, ClipboardList, Check, ArrowRight, ArrowLeft } from 'lucide-react'
import useFocusTrap from './ui/useFocusTrap'
import { PROJECT_TEMPLATES, DEFAULT_TEMPLATE_ID, describeTemplate } from '../../../shared/projectTemplates'

/** padding around the revealed element */
const SPOT_PAD = 8
/** gap between spotlight and card */
const CARD_GAP = 16
const CARD_WIDTH = 380

interface Step {
  id: string
  title: string
  body: string
  /** absent means a centred card */
  target?: string
}

const STEPS: Step[] = [
  {
    // a question, not a slide: people clicked through without noticing they'd been asked
    id: 'welcome',
    title: 'Welcome to Checkpoint',
    body: 'A board, a backlog, notes, a focus timer, clipboard history and an AI assistant. In one place, organised by workspace. Everything stays on this machine: no account, no cloud, no sign-in.'
  },
  {
    // second, not last: whoever reaches the end already didn't skip
    id: 'palette',
    title: 'Try the command palette',
    body: 'It reaches any view, workspace or action by name, and it is the fastest way around the app. Press it now and the tour moves on.'
  },
  {
    id: 'workspace',
    title: 'What are you working on?',
    body: 'A workspace keeps one project’s board, notes and tasks together. You can add more later.'
  },
  {
    id: 'sidebar',
    title: 'Your workspaces and views',
    body: 'The badge at the top switches between workspaces. Each has its own board, notes and history. Below it is every view: board, backlog, notes, the Wall, focus timer, clipboard, analytics. Hover any icon for its name.',
    target: '#app-sidebar'
  },
  {
    id: 'keys',
    title: 'Two more worth knowing',
    body: 'Like the palette, these work from anywhere, even when Checkpoint is in the background.'
  }
]

const KEYS: { combo: string; name: string; why: string; icon: React.ReactNode }[] = [
  { combo: 'Ctrl + Shift + Space', name: 'Quick capture', why: 'Jot a task without leaving what you are doing.', icon: <Zap size={15} /> },
  { combo: 'Ctrl + Shift + V', name: 'Clipboard history', why: 'Everything you have copied, searchable.', icon: <ClipboardList size={15} /> }
]

/** matches the binding in App.tsx */
const PALETTE_COMBO = 'Ctrl + K'

interface Rect { top: number; left: number; width: number; height: number }

interface Props {
  onCreateWorkspace: (name: string, templateId: string) => Promise<void>
  /** Done and Skip are answers; Escape asks again next launch */
  onClose: (remember: boolean) => void
}

export default function OnboardingTour({ onCreateWorkspace, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [creating, setCreating] = useState(false)
  const [palettePressed, setPalettePressed] = useState(false)
  const [error, setError] = useState('')
  /** remembers the created workspace so Back doesn't show a form that can only fail */
  const [created, setCreated] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  // aria-modal needs a real focus trap; start on the primary action, Skip comes first in the DOM
  const cardRef = useFocusTrap(true, primaryRef)

  const step = STEPS[index]

  /** Escape clears a field first, only a second press leaves */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (e.target === nameRef.current && name !== '') {
        e.stopPropagation()
        setName('')
        setError('')
        return
      }
      onClose(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [name, onClose])

  /** layout effect so the spotlight never paints a stale frame */
  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return }
    const el = document.querySelector(step.target)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    // zero-size means present but not laid out, treat as absent
    if (r.width === 0 || r.height === 0) { setRect(null); return }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step.target])

  useLayoutEffect(() => { measure() }, [measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  useEffect(() => {
    if (step.id === 'workspace') nameRef.current?.focus()
    else primaryRef.current?.focus()
  }, [step.id])

  /** passed by doing it; captured and swallowed so the palette doesn't open over the tour */
  useEffect(() => {
    if (step.id !== 'palette' || palettePressed) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setPalettePressed(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [step.id, palettePressed])

  // long enough to read as confirmation; by index to dodge a stale closure
  useEffect(() => {
    if (!palettePressed) return
    const timer = setTimeout(() => {
      setIndex(i => Math.min(i + 1, STEPS.length - 1))
      setPalettePressed(false)
    }, 850)
    return () => clearTimeout(timer)
  }, [palettePressed])

  const next = (): void => setIndex(i => Math.min(i + 1, STEPS.length - 1))
  const back = (): void => setIndex(i => Math.max(i - 1, 0))

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setError('')
    try {
      await onCreateWorkspace(trimmed, templateId)
      setCreated(trimmed)
      next()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace. Try again.')
    } finally {
      setCreating(false)
    }
  }

  // right of the spotlight if there's room, else left; clamped to the viewport
  const cardStyle: React.CSSProperties = (() => {
    if (!rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: `${CARD_WIDTH}px` }
    }
    const roomRight = window.innerWidth - (rect.left + rect.width) - CARD_GAP
    const placeRight = roomRight >= CARD_WIDTH
    const left = placeRight
      ? rect.left + rect.width + CARD_GAP
      : Math.max(CARD_GAP, rect.left - CARD_WIDTH - CARD_GAP)
    const top = Math.min(
      Math.max(CARD_GAP, rect.top + rect.height / 2 - 90),
      Math.max(CARD_GAP, window.innerHeight - 260)
    )
    return { top: `${top}px`, left: `${left}px`, width: `${CARD_WIDTH}px` }
  })()

  const isLast = index === STEPS.length - 1
  /** reads as a confirmation once done */
  const settled = step.id === 'workspace' && created !== null
  const heading = settled ? 'Workspace created' : step.title
  const blurb = settled
    ? 'That is this step done. Nothing here needs doing twice.'
    : step.body

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997 }}>

      {/* blocks clicks on the app, the box-shadow scrim paints but gets no pointer events */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0 }} />

      {/* the hole is a 9999px shadow around a transparent box; out of flow, so animating it can't reflow */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          top: rect ? rect.top - SPOT_PAD : 0,
          left: rect ? rect.left - SPOT_PAD : 0,
          width: rect ? rect.width + SPOT_PAD * 2 : '100%',
          height: rect ? rect.height + SPOT_PAD * 2 : '100%',
          borderRadius: rect ? 'var(--radius-lg)' : 0,
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${rect ? 0.62 : 0.55})`,
          border: rect ? '2px solid var(--color-secondary)' : '2px solid transparent',
          transition: [
            'top var(--duration-slow) var(--ease-default)',
            'left var(--duration-slow) var(--ease-default)',
            'width var(--duration-slow) var(--ease-default)',
            'height var(--duration-slow) var(--ease-default)',
            'border-radius var(--duration-slow) var(--ease-default)'
          ].join(', ')
        }}
      />

      {/* two elements: outer positions and centres, inner animates, or the keyframes drop the centring translate */}
      <div
        style={{
          position: 'fixed',
          ...cardStyle,
          transition: 'top var(--duration-slow) var(--ease-default), left var(--duration-slow) var(--ease-default)'
        }}
      >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        style={{
          width: '100%',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-2xl)',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          outline: 'none',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          animation: 'modal-pop-in var(--duration-enter) var(--ease-enter)'
        }}
      >
        {/* no progress on the first card, it's still asking whether to start */}
        {index > 0 && (
        <div role="group" aria-label={`Step ${index + 1} of ${STEPS.length}`} className="flex-4px">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              aria-hidden="true"
              style={{
                height: '3px',
                flex: 1,
                borderRadius: '2px',
                background: i <= index ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
                transition: 'background var(--duration-normal) var(--ease-default)'
              }}
            />
          ))}
        </div>
        )}

        <div>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            marginBottom: 'var(--space-2)'
          }}>
            {heading}
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {blurb}
          </p>
        </div>

        {/* asked out loud, not implied by the buttons */}
        {index === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)'
          }}>
            <Compass size={18} className="icon-accent" />
            <div className="min-w-0">
              <div className="text-item">
                Would you like a quick tour?
              </div>
              <div className="text-caption-sub">
                About a minute. You can leave it at any point, and replay it later from Settings.
              </div>
            </div>
          </div>
        )}

        {step.id === 'palette' && (
          <div
            aria-live="polite"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-5) var(--space-3)',
              background: 'var(--color-surface-2)',
              border: `1px solid ${palettePressed ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
              borderRadius: 'var(--radius-md)',
              transition: 'border-color var(--duration-normal) var(--ease-default)'
            }}
          >
            {palettePressed ? (
              <>
                <Check size={22} className="text-accent" />
                <span className="text-item">
                  That’s it. That is how you reach anything.
                </span>
              </>
            ) : (
              <>
                <Command size={22} className="text-accent" />
                <kbd style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-text-base)',
                  background: 'var(--color-surface-offset)',
                  border: '1px solid var(--color-surface-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px',
                  letterSpacing: '0.02em'
                }}>
                  {PALETTE_COMBO}
                </kbd>
                <span className="text-caption-faint">
                  Waiting for the keystroke…
                </span>
              </>
            )}
          </div>
        )}

        {/* already created, so a confirmation; a live form could only refuse the name or dupe it */}
        {step.id === 'workspace' && created && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-secondary)',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <Check size={20} className="icon-accent" />
            <div className="min-w-0">
              <div className="text-item">
                {created} is ready
              </div>
              <div className="text-caption-sub">
                You are in it now. More workspaces come from the badge at the top of the sidebar.
              </div>
            </div>
          </div>
        )}

        {step.id === 'workspace' && !created && (
          <>
            <div className="col-1-5">
              <label
                htmlFor="onboarding-workspace-name"
                className="text-hint-strong"
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
                  background: 'var(--color-surface-2)',
                  border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-surface-offset)'}`,
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none'
                }}
              />
              {error && (
                <span role="alert" style={{ fontSize: '11px', color: 'var(--color-error)' }}>{error}</span>
              )}
            </div>

            <div className="col">
              <span className="text-hint-strong">
                Start from
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }}>
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
                        background: selected ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
                        border: `1px solid ${selected ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-2) var(--space-3)',
                        cursor: 'pointer',
                        width: '100%'
                      }}
                    >
                      <span className="text-item">
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

        {step.id === 'keys' && (
          <div className="col">
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
                <span style={{ color: 'var(--color-secondary)', flexShrink: 0, marginTop: '2px' }}>{k.icon}</span>
                <div className="min-w-0">
                  <div className="row-wrap">
                    <span className="text-item">
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
                  <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>{k.why}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="row-between-gap">
          {/* both answers sit together on the right at equal weight */}
          {index === 0 ? <span /> : (
            <button
              className="btn-ghost"
              onClick={back}
              disabled={creating}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', opacity: creating ? 0.5 : 1 }}
            >
              <ArrowLeft size={13} /> Back
            </button>
          )}

          <div className="row">
            {/* on the form, secondary skips the step, not the whole tour */}
            {index === 0 ? (
              <button
                className="btn-secondary"
                onClick={() => onClose(true)}
                style={{ fontSize: 'var(--text-xs)' }}
              >
                No thanks
              </button>
            ) : settled ? null : step.id === 'workspace' ? (
              <button
                className="btn-ghost"
                onClick={next}
                disabled={creating}
                style={{ fontSize: 'var(--text-xs)', opacity: creating ? 0.5 : 1 }}
              >
                Not now
              </button>
            ) : step.id === 'palette' ? null : index > 0 && !isLast ? (
              <button
                className="btn-ghost"
                onClick={() => onClose(true)}
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Skip tour
              </button>
            ) : null}

            {/* no primary Next here: the keystroke is the point, the way out stays quiet */}
            {step.id === 'palette' ? (
              <button
                ref={primaryRef}
                className="btn-ghost"
                onClick={next}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                Skip this <ArrowRight size={13} />
              </button>
            ) : settled ? (
              <button
                ref={primaryRef}
                className="btn-primary"
                onClick={next}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                Next <ArrowRight size={13} />
              </button>
            ) : step.id === 'workspace' ? (
              <button
                ref={primaryRef}
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
            ) : isLast ? (
              <button
                ref={primaryRef}
                className="btn-primary"
                onClick={() => onClose(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                <Check size={13} /> Done
              </button>
            ) : (
              <button
                ref={primaryRef}
                className="btn-primary"
                onClick={next}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                {index === 0 ? 'Show me around' : 'Next'} <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
