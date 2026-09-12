import React, { useState, useEffect, useRef } from 'react'
import { parseNaturalDate, describeDue } from '../../../shared/naturalDate'
import { readWorkspaceList } from '../lib/workspaceList'

// SVG Icons

function IconChevronRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function IconLoader(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" {...props}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  )
}

// Helpers

interface ParsedResult {
  text: string
  cleanedText: string
  type: 'log' | 'task'
  context: string
  priority: 0 | 1 | 2 | 3
  tags: string[]
  /** Epoch milliseconds from a phrase like "tomorrow 3pm", or null. */
  dueAt: number | null
  /** The phrase that produced it, shown back as a pill while typing. */
  dueSource: string | null
}

function parseInput(input: string): ParsedResult {
  let text = input.trim()
  let type: 'log' | 'task' = 'log'

  // 1. Check type prefix
  if (text.startsWith('- ')) {
    type = 'task'
    text = text.substring(2)
  } else if (text.startsWith('[ ] ')) {
    type = 'task'
    text = text.substring(4)
  }

  // 2. Parse priority (!high, !med, !low, !none or !3, !2, !1, !0)
  let priority: 0 | 1 | 2 | 3 = 0
  const priorityMatch = text.match(/!(high|med|medium|low|none|3|2|1|0)\b/i)
  if (priorityMatch) {
    const val = priorityMatch[1].toLowerCase()
    if (val === 'high' || val === '3') priority = 3
    else if (val === 'med' || val === 'medium' || val === '2') priority = 2
    else if (val === 'low' || val === '1') priority = 1
    else if (val === 'none' || val === '0') priority = 0
    text = text.replace(/!(high|med|medium|low|none|3|2|1|0)\b/i, '')
  }

  // 3. Parse context (@context-slug)
  let context = 'default'
  const contextMatch = text.match(/@([a-zA-Z0-9_-]+)\b/)
  if (contextMatch) {
    context = contextMatch[1]
    text = text.replace(/@([a-zA-Z0-9_-]+)\b/, '')
  }

  // 4. Parse tags (#tag-slug)
  const tags: string[] = []
  const tagMatches = Array.from(text.matchAll(/#([a-zA-Z0-9_-]+)\b/g))
  tagMatches.forEach(match => {
    tags.push(match[1])
  })
  text = text.replace(/#([a-zA-Z0-9_-]+)\b/g, '')

  // 5. Parse the due date last, so it only ever sees what the other rules left
  //    behind. Otherwise a tag like #tuesday would be read as a weekday.
  const dated = parseNaturalDate(text.replace(/\s+/g, ' ').trim())
  const cleanedText = dated.cleanedText

  return {
    text: input,
    cleanedText,
    dueAt: dated.dueAt,
    dueSource: dated.matched,
    type,
    context,
    priority,
    tags
  }
}

/**
 * Synthesizes a soft, clean two-tone chime via Web Audio API.
 */
const playChime = () => {
  try {
    const audioCtx = new AudioContext()
    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()

    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    osc.type = 'sine'
    // Two-tone progressive pitch
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime) // D5
    osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.08) // A5

    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.32)

    osc.start()
    osc.stop(audioCtx.currentTime + 0.36)
  } catch (e) {
    console.error('Chime audio failure:', e)
  }
}

// Main Component

export default function HudView() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [isFocused, setIsFocused] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // Live parsed state for visual pills
  const parsed = parseInput(value)

  // Focus input automatically on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Listen to main process reset triggers (e.g. on blur/hide)
  useEffect(() => {
    const unsub = window.electronAPI.hud.onReset(() => {
      setValue('')
      setError(null)
    })
    return unsub
  }, [])

  // Handle resizing: resize HUD height dynamically to accommodate errors or syntax tips
  useEffect(() => {
    if (error) {
      window.electronAPI.hud.resize(100)
    } else if (isFocused) {
      window.electronAPI.hud.resize(84)
    } else {
      window.electronAPI.hud.resize(64)
    }
  }, [error, isFocused])

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (submitting) return
      // Hide window (blur listener will also reset inputs)
      await window.electronAPI.hud.toggle(false)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (submitting) return

      if (!parsed.cleanedText) {
        setError('Input content cannot be empty.')
        return
      }

      setSubmitting(true)
      setError(null)

      try {
        // Context validation
        if (parsed.context !== 'default') {
          const contexts = await readWorkspaceList()
          const exists = contexts.some(c => c.slug.toLowerCase() === parsed.context.toLowerCase())
          if (!exists) {
            setError(`Workspace '@${parsed.context}' does not exist.`)
            setSubmitting(false)
            return
          }
        }

        // 1. Resolve and create tags as needed
        const existingTags = await window.electronAPI.db.getTags()
        const tagIds: string[] = []

        for (const tagName of parsed.tags) {
          const matched = existingTags.find(t => t.name.toLowerCase() === tagName.toLowerCase())
          if (matched) {
            tagIds.push(matched.id)
          } else {
            // Create tag dynamically
            const newTag = await window.electronAPI.db.createTag({
              name: tagName.toLowerCase(),
              color: '#535e85'
            })
            tagIds.push(newTag.id)
          }
        }

        // 2. Insert item into SQLite database
        await window.electronAPI.db.createItem({
          type: parsed.type,
          context: parsed.context,
          title: parsed.cleanedText,
          body: '',
          status: 'open',
          priority: parsed.priority,
          position: Date.now(),
          due_at: parsed.dueAt,
          metadata: '{}'
        }, tagIds)

        // 3. Success feedback & hide HUD
        playChime()
        setValue('')
        await window.electronAPI.hud.toggle(false)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Database write failure'
        setError(msg)
      } finally {
        setSubmitting(false)
      }
    }
  }

  // Visual Priority styling
  const priorityLabels = ['None', 'Low', 'Med', 'High']
  const priorityColors = [
    'var(--color-text-faint)',
    'var(--color-priority-low)',
    'var(--color-priority-med)',
    'var(--color-priority-high)'
  ]

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-start',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      padding: '4px'
    }}>
      <style>{`
        .hud-container {
          width: 590px;
          display: flex;
          flex-direction: column;
          background: color-mix(in srgb, var(--color-surface-1) 94%, transparent);
          backdrop-filter: blur(12px);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-2xl), 0 0 0 1px color-mix(in srgb, var(--color-text-base) 8%, transparent);
          overflow: hidden;
          transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
        }
        .hud-container.focused {
          border-color: var(--color-secondary);
          box-shadow: var(--shadow-2xl), 0 0 12px var(--color-secondary-muted);
        }
        .hud-container.has-error {
          border-color: var(--color-error);
          box-shadow: var(--shadow-2xl), 0 0 12px var(--color-error-muted);
        }
        .hud-bar {
          height: 54px;
          display: flex;
          align-items: center;
          padding: 0 var(--space-4);
          gap: var(--space-2);
        }
        .hud-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--color-text-base);
          font-size: var(--text-md);
          font-weight: var(--weight-normal);
        }
        .hud-input::placeholder {
          color: var(--color-text-faint);
        }
        .hud-pill {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: var(--weight-semibold);
          display: flex;
          align-items: center;
          gap: 4px;
          text-transform: uppercase;
        }
        .hud-error-tray {
          height: 36px;
          background: var(--color-error-muted);
          border-top: 1px solid color-mix(in srgb, var(--color-error) 25%, transparent);
          display: flex;
          align-items: center;
          padding: 0 var(--space-4);
          font-size: var(--text-xs);
          color: var(--color-error);
          animation: slide-down 150ms var(--ease-enter);
        }
        .hud-tip-tray {
          height: 24px;
          background: var(--color-surface-2);
          border-top: 1px solid var(--color-surface-offset);
          display: flex;
          align-items: center;
          padding: 0 var(--space-4);
          font-size: var(--text-2xs);
          color: var(--color-text-muted);
          animation: slide-down 150ms var(--ease-enter);
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>

      <div className={`hud-container ${error ? 'has-error' : isFocused ? 'focused' : ''}`}>
        <div className="hud-bar">
          {submitting ? (
            <IconLoader style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          ) : (
            <IconChevronRight style={{ color: error ? 'var(--color-error)' : 'var(--color-secondary)', flexShrink: 0 }} />
          )}
          
          <input
            ref={inputRef}
            type="text"
            className="hud-input"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null) }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Type a task (- task #tag @unity !high tomorrow 3pm) or daily log..."
            aria-label="Quick capture input"
            disabled={submitting}
            style={{ opacity: submitting ? 0.5 : 1 }}
          />

          {/* Live Parser Visual feedback pills */}
          {value.trim().length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0, alignItems: 'center' }}>
              {/* Type Badge */}
              <div className="hud-pill" style={{ background: 'var(--color-surface-offset)', color: 'var(--color-text-base)' }}>
                {parsed.type}
              </div>

              {/* Shown resolved rather than as typed, so an ambiguous phrase is
                  confirmed before the item is created. */}
              {parsed.dueAt !== null && (
                <div
                  className="hud-pill"
                  title={parsed.dueSource ? 'from "' + parsed.dueSource + '"' : undefined}
                  style={{
                    background: 'var(--color-primary-muted)',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-primary)'
                  }}
                >
                  {describeDue(parsed.dueAt)}
                </div>
              )}

              {/* Context Badge */}
              {parsed.context !== 'default' && (
                <div className="hud-pill" style={{ background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)', border: '1px solid var(--color-secondary)' }}>
                  @{parsed.context}
                </div>
              )}

              {/* Priority Badge */}
              {parsed.priority > 0 && (
                <div className="hud-pill" style={{ background: 'var(--color-surface-2)', color: priorityColors[parsed.priority] }}>
                  !{priorityLabels[parsed.priority]}
                </div>
              )}

              {/* Tags Count */}
              {parsed.tags.map((tag, idx) => (
                <div key={idx} className="hud-pill" style={{ background: 'color-mix(in srgb, var(--color-balance) 25%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-balance)' }}>
                  #{tag}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error Feedback Drawer */}
        {error && (
          <div className="hud-error-tray">
            ⚠️ {error}
          </div>
        )}

        {/* Syntax Tip Tray */}
        {isFocused && !error && (
          <div className="hud-tip-tray">
            💡 Tip: Use - for tasks, @context, #tag, !high/med/low, and a date like tomorrow 3pm, friday, or in 2 days.
          </div>
        )}
      </div>
    </div>
  )
}
