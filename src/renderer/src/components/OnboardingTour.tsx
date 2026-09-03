/**
 * The first-run tour.
 *
 * Checkpoint opens onto fourteen views and around thirty services with nothing
 * to orient a new user, and its two best features, the command palette and
 * quick capture, are invisible unless you already know the keys.
 *
 * Steps that can point at something do. A spotlight cuts a hole in a dimming
 * layer over the real element and glides between targets, so the tour explains
 * the actual interface rather than a picture of it. Steps with nothing to point
 * at (the welcome, the workspace form, the keyboard shortcuts) render centred.
 *
 * Two things the targeting has to survive:
 *   - Nav items are filtered by `enabledViews`, so a target may genuinely not
 *     exist. A missing target falls back to the centred layout rather than
 *     spotlighting the top-left corner.
 *   - The window can resize mid-tour, so the measurement re-runs.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Command, Zap, ClipboardList, Check, ArrowRight, ArrowLeft } from 'lucide-react'
import useEscapeKey from './ui/useEscapeKey'
import useFocusTrap from './ui/useFocusTrap'
import { PROJECT_TEMPLATES, DEFAULT_TEMPLATE_ID, describeTemplate } from '../../../shared/projectTemplates'

/** Breathing room between the spotlight edge and the element it reveals. */
const SPOT_PAD = 8
/** Gap between the spotlight and the card that explains it. */
const CARD_GAP = 16
const CARD_WIDTH = 380

interface Step {
  id: string
  title: string
  body: string
  /** CSS selector for the element to reveal. Absent means a centred card. */
  target?: string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to Checkpoint',
    body: 'A board, a backlog, notes, a focus timer, clipboard history and an AI assistant, in one place, organised by workspace. Everything stays on this machine: no account, no cloud, no sign-in.'
  },
  {
    // Second, not last. This is the most useful thing in the tour, and anything
    // at the end is read by whoever did not skip, which is the wrong half.
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
    body: 'The badge at the top switches between workspaces, each has its own board, notes and history. Below it is every view: board, backlog, notes, focus timer, clipboard, analytics. Hover any icon for its name.',
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

/** What the palette step listens for. Matches the binding in App.tsx. */
const PALETTE_COMBO = 'Ctrl + K'

interface Rect { top: number; left: number; width: number; height: number }

interface Props {
  onCreateWorkspace: (name: string, templateId: string) => Promise<void>
  onClose: () => void
}

export default function OnboardingTour({ onCreateWorkspace, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [creating, setCreating] = useState(false)
  const [palettePressed, setPalettePressed] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  // The card declares aria-modal, so focus has to actually be held inside it.
  // Without the trap, Tab walked out into the app behind, which is dimmed and
  // click-blocked, so focus landed on controls the user could neither see the
  // state of nor operate.
  //
  // Focus starts on the primary action rather than the first focusable in DOM
  // order, which is Skip: landing there means Enter abandons the tour.
  const cardRef = useFocusTrap(true, primaryRef)

  const step = STEPS[index]
  useEscapeKey(onClose, true)

  /**
   * Measured in a layout effect so the spotlight is never painted at a stale
   * position for a frame, which reads as a flicker rather than a glide.
   */
  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return }
    const el = document.querySelector(step.target)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    // A zero-size box means the element is present but not laid out; treat it
    // as absent rather than spotlighting a point.
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

  /**
   * The palette step is passed by doing, not by reading.
   *
   * Captured on the window rather than the card, so it fires wherever focus
   * happens to be, and swallowed so the palette does not open on top of the
   * tour: what the step is teaching is the gesture, and a second modal over the
   * first would only be something else to dismiss. App.tsx binds the same combo
   * on the bubble phase, which stopPropagation here prevents from running.
   */
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

  // Long enough to register as a confirmation, short enough not to feel like a
  // wait. Advancing by index rather than through `next` keeps this free of a
  // stale closure over the render that scheduled it.
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
      next()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace. Try again.')
    } finally {
      setCreating(false)
    }
  }

  // Card placement
  // To the right of the spotlight when there is room, which there always is for
  // the sidebar rail; flipped to the left otherwise. Clamped to the viewport so
  // a target near an edge cannot push the card off screen.
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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9997 }}>

      {/* Swallows clicks on the app underneath. The dimming layer below cannot
          do this itself: its scrim is a box-shadow, which paints but never
          receives pointer events, so without this the whole interface stayed
          clickable while looking disabled. Escape and Skip are the ways out. */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0 }} />

      {/* The dimming layer
          With no target this is a plain scrim. With one, the scrim is the
          9999px shadow spread around a transparent box, which is what cuts the
          hole. Only this element's own box changes between steps, it is out of
          flow with no children, so animating its geometry cannot reflow the
          document beneath it. */}
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

      {/* The card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
        style={{
          position: 'fixed',
          ...cardStyle,
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
          animation: 'modal-pop-in var(--duration-enter) var(--ease-enter)',
          transition: 'top var(--duration-slow) var(--ease-default), left var(--duration-slow) var(--ease-default)'
        }}
      >
        {/* Progress */}
        <div role="group" aria-label={`Step ${index + 1} of ${STEPS.length}`} style={{ display: 'flex', gap: '4px' }}>
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

        <div>
          <h2 style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text-base)',
            marginBottom: 'var(--space-2)'
          }}>
            {step.title}
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {step.body}
          </p>
        </div>

        {/* Press the combo */}
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
                <Check size={22} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
                  That’s it, that is how you reach anything.
                </span>
              </>
            ) : (
              <>
                <Command size={22} style={{ color: 'var(--color-secondary)' }} />
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
                <span style={{ fontSize: '11px', color: 'var(--color-text-faint)' }}>
                  Waiting for the keystroke…
                </span>
              </>
            )}
          </div>
        )}

        {/* Workspace form */}
        {step.id === 'workspace' && (
          <>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
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
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
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

        {/* The keys */}
        {step.id === 'keys' && (
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
                <span style={{ color: 'var(--color-secondary)', flexShrink: 0, marginTop: '2px' }}>{k.icon}</span>
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
                  <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>{k.why}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <button
            className="btn-ghost"
            onClick={index === 0 ? onClose : back}
            disabled={creating}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', opacity: creating ? 0.5 : 1 }}
          >
            {index === 0 ? 'Skip' : <><ArrowLeft size={13} /> Back</>}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {/* On the form, the secondary action moves past it rather than
                ending the tour, not wanting a workspace right now is not the
                same as not wanting the rest. */}
            {step.id === 'workspace' ? (
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
                onClick={onClose}
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Skip tour
              </button>
            ) : null}

            {/* No primary Next on the palette step: an easier way past would be
                the one most people take, and the keystroke is the whole point.
                The way out is deliberately the quieter control. */}
            {step.id === 'palette' ? (
              <button
                ref={primaryRef}
                className="btn-ghost"
                onClick={next}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)' }}
              >
                Skip this <ArrowRight size={13} />
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
                onClick={onClose}
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
                {index === 0 ? 'Get started' : 'Next'} <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
