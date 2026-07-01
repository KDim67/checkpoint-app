import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Play, Pause, X, Check, Timer, Award, ArrowRight, BookOpen, RotateCcw, SkipForward } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useToast } from './ui/Toast'
import type { Item, FocusSession } from '../../../shared/types'
import { TIMER_PRESETS, formatTime, type TimerPreset } from './focus/pomodoroTimer'
import ConfirmDialog from './ui/ConfirmDialog'

interface SelectedTask {
  id: string
  title: string
  completed: boolean
}

export default function FocusView() {
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()

  // Component State
  const [step, setStep] = useState<'setup' | 'active' | 'retro'>('setup')
  const [dbItems, setDbItems] = useState<Item[]>([])
  const [selectedTasks, setSelectedTasks] = useState<Item[]>([])
  const [preset, setPreset] = useState<TimerPreset | 'custom'>('focus')
  const [customMinutes, setCustomMinutes] = useState(25)
  const [loading, setLoading] = useState(true)

  // Timer Engine State
  const [timeLeftMs, setTimeLeftMs] = useState(25 * 60 * 1000)
  const [durationMs, setDurationMs] = useState(25 * 60 * 1000)
  const [isRunning, setIsRunning] = useState(false)
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0)

  // Retrospective State
  const [retroNotes, setRetroNotes] = useState('')
  const [retroTasks, setRetroTasks] = useState<SelectedTask[]>([])
  const [pastSessions, setPastSessions] = useState<FocusSession[]>([])

  // Confirmation dialog states
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  // Reuse a single AudioContext across all chime calls (avoids accumulation)
  const audioCtxRef = useRef<AudioContext | null>(null)
  useEffect(() => {
    return () => {
      // Close AudioContext on unmount to release OS audio resources
      audioCtxRef.current?.close()
      audioCtxRef.current = null
    }
  }, [])

  // Synthesize beautiful chime tone locally using HTML5 Web Audio API
  const playChime = useCallback(() => {
    try {
      // Reuse existing context, or create one if needed
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext()
      }
      const audioCtx = audioCtxRef.current
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)

        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, start)
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.2, start + 0.05)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

        osc.start(start)
        osc.stop(start + duration)
      }
      const now = audioCtx.currentTime
      playTone(523.25, now, 0.25) // C5
      playTone(659.25, now + 0.15, 0.4) // E5
      playTone(783.99, now + 0.3, 0.6) // G5
    } catch (err) {
      console.error('AudioContext chime failed:', err)
    }
  }, [])

  const handleTimerComplete = useCallback(() => {
    setIsRunning(false)
    playChime()
    // Setup retro tasks checklist from the selected focus items
    setRetroTasks(
      selectedTasks.map(t => ({
        id: t.id,
        title: t.title,
        completed: t.status === 'done'
      }))
    )
    setStep('retro')
    toast('Focus interval completed! Time for a break.', { type: 'success' })
  }, [selectedTasks, toast, playChime])

  // Load Uncompleted Items & History
  const loadFocusData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch uncompleted cards and tasks
      const cardsRes = await window.electronAPI.db.getItems(activeContext, 'card', 1, 100)
      const tasksRes = await window.electronAPI.db.getItems(activeContext, 'task', 1, 100)

      const merged = [...cardsRes.items, ...tasksRes.items].filter(
        item => item.status !== 'done'
      )
      setDbItems(merged)

      // 2. Fetch past focus sessions
      const sessions = await window.electronAPI.db.getFocusSessions(activeContext)
      setPastSessions(sessions.slice(0, 5)) // show top 5 recent sessions

      // 3. Handle preselected task navigation for immediate Pomodoro timer start
      const preselectedId = useAppStore.getState().preselectedTaskId
      if (preselectedId) {
        const found = merged.find(item => item.id === preselectedId)
        if (found) {
          setSelectedTasks([found])
          const ms = TIMER_PRESETS['focus'].durationMs
          setTimeLeftMs(ms)
          setDurationMs(ms)
          setElapsedTimeMs(0)
          setIsRunning(true)
          setStep('active')
          useAppStore.getState().setPreselectedTaskId(null)
          toast(`Started focus session for: ${found.title}`, { type: 'success' })
        }
      }
    } catch (err) {
      console.error('Failed to load focus view data:', err)
      toast('Failed to load tasks and history', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [activeContext, toast])

  useEffect(() => {
    loadFocusData()
  }, [loadFocusData])

  // Timer Setup & Control Helpers
  const getSelectedDurationMs = useCallback(() => {
    if (preset === 'custom') {
      return customMinutes * 60 * 1000
    }
    return TIMER_PRESETS[preset].durationMs
  }, [preset, customMinutes])

  // Reset timer when preset changes
  useEffect(() => {
    if (step === 'setup') {
      const ms = getSelectedDurationMs()
      setTimeLeftMs(ms)
      setDurationMs(ms)
    }
  }, [preset, customMinutes, getSelectedDurationMs, step])

  // Timer countdown engine
  useEffect(() => {
    if (step !== 'active' || !isRunning) return

    const interval = setInterval(() => {
      setTimeLeftMs(prev => {
        if (prev <= 1000) {
          clearInterval(interval)
          handleTimerComplete()
          return 0
        }
        return prev - 1000
      })
      setElapsedTimeMs(prev => prev + 1000)
    }, 1000)

    return () => clearInterval(interval)
  }, [step, isRunning, handleTimerComplete])

  const handleStartSession = () => {
    if (selectedTasks.length === 0) {
      toast('Please select at least 1 task to focus on', { type: 'info' })
      return
    }
    const ms = getSelectedDurationMs()
    setTimeLeftMs(ms)
    setDurationMs(ms)
    setElapsedTimeMs(0)
    setIsRunning(true)
    setStep('active')
  }

  const handleToggleTimer = () => {
    setIsRunning(!isRunning)
  }

  const handleResetTimer = () => {
    setIsRunning(false)
    setTimeLeftMs(durationMs)
    setElapsedTimeMs(0)
  }

  const handleSkipTimer = () => {
    // End session early and proceed to retrospective
    setIsRunning(false)
    setRetroTasks(
      selectedTasks.map(t => ({
        id: t.id,
        title: t.title,
        completed: t.status === 'done'
      }))
    )
    setStep('retro')
  }

  const handleCancelSession = () => {
    setShowCancelConfirm(true)
  }

  const performCancelSession = () => {
    setShowCancelConfirm(false)
    setIsRunning(false)
    setStep('setup')
    loadFocusData()
  }

  // Task Selection / Inline Completion
  const handleToggleTaskSelection = (task: Item) => {
    const isSelected = selectedTasks.some(t => t.id === task.id)
    if (isSelected) {
      setSelectedTasks(prev => prev.filter(t => t.id !== task.id))
    } else {
      if (selectedTasks.length >= 3) {
        toast('Focus Mode is optimized for 1-3 tasks at a time.', { type: 'info' })
        return
      }
      setSelectedTasks(prev => [...prev, task])
    }
  }

  const handleToggleTaskDoneActive = async (task: Item) => {
    const isDone = task.status === 'done'
    const newStatus = isDone ? 'open' : 'done'

    try {
      // 1. Update status in Database
      await window.electronAPI.db.updateItem(task.id, { status: newStatus })

      // 2. Update local state
      setSelectedTasks(prev =>
        prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t))
      )
      setDbItems(prev =>
        prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t))
      )

      toast(`Task marked as ${newStatus}`, { type: 'success' })
    } catch (err) {
      console.error('Failed to update task status:', err)
      toast('Failed to update task status', { type: 'error' })
    }
  }

  const handleToggleRetroTask = (taskId: string) => {
    setRetroTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, completed: !t.completed } : t))
    )
  }

  // Save Retrospective Row & Log
  const handleSaveRetrospective = async () => {
    try {
      const selectedTasksJson = JSON.stringify(
        retroTasks.map(t => ({ id: t.id, title: t.title, completed: t.completed }))
      )

      // 1. Write session row to focus_sessions
      await window.electronAPI.db.createFocusSession({
        context: activeContext,
        duration_ms: elapsedTimeMs,
        notes: retroNotes.trim(),
        tasks_json: selectedTasksJson
      })

      // 2. Sync database status for any checked retro tasks that were not updated yet
      for (const t of retroTasks) {
        const dbItem = dbItems.find(item => item.id === t.id)
        const expectedStatus = t.completed ? 'done' : 'open'
        if (dbItem && dbItem.status !== expectedStatus) {
          await window.electronAPI.db.updateItem(t.id, { status: expectedStatus })
        }
      }

      // 3. Format beautiful markdown for retrospective log entry
      const totalMinutes = Math.round(elapsedTimeMs / 60000)
      const tasksMarkdownList = retroTasks
        .map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`)
        .join('\n')

      const logBody = `### Focus Session Retrospective 🧘
**Duration:** ${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}
**Preset:** ${preset.replace('-', ' ')}
**Focus Task Checklist:**
${tasksMarkdownList || '_No specific tasks selected_'}

**Retrospective Notes:**
${retroNotes.trim() || '_No custom notes written._'}`

      const title = `Focus Session (${totalMinutes}m)`

      // 4. Create log entry in DB
      await window.electronAPI.db.createItem({
        type: 'log',
        context: activeContext,
        title,
        body: logBody,
        status: 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: '{}'
      })

      toast('Session retrospective saved to log feed', { type: 'success' })

      // 5. Clean up state and route back to logs feed
      setSelectedTasks([])
      setRetroNotes('')
      setStep('setup')
      setView('log')
    } catch (err) {
      console.error('Failed to save focus session:', err)
      toast('Error saving session details', { type: 'error' })
    }
  }

  // Rendering Helper Computations
  const progressPercent = useMemo(() => {
    return durationMs > 0 ? (timeLeftMs / durationMs) * 100 : 0
  }, [timeLeftMs, durationMs])

  const circumference = 2 * Math.PI * 90 // radius = 90
  const strokeDashoffset = useMemo(() => {
    return circumference * (1 - progressPercent / 100)
  }, [progressPercent, circumference])

  // Context color picker
  const activeColor = preset === 'focus' ? 'var(--color-secondary)' : (preset === 'short-break' ? '#10b981' : '#8b5cf6')

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: 'var(--space-6)',
        overflowY: 'auto',
        background: 'var(--color-background)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)'
      }}
    >
      <style>{`
        .glass-panel {
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          transition: all var(--duration-normal) var(--ease-default);
        }
        .glass-panel:hover {
          border-color: var(--color-balance);
        }
        .task-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3);
          border-radius: var(--radius-md);
          background: var(--color-surface-2);
          border: 1px solid var(--color-surface-offset);
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-default);
        }
        .task-row:hover {
          background: var(--color-surface-offset);
          border-color: var(--color-balance);
        }
        .task-row.selected {
          border-color: var(--color-secondary);
          background: var(--color-secondary-muted);
        }
        .btn-volt {
          background: var(--color-secondary);
          color: var(--color-text-inverted);
          border: none;
          font-weight: var(--weight-bold);
          border-radius: var(--radius-md);
          padding: 8px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          transition: transform var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
        }
        .btn-volt:hover:not(:disabled) {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }
        .btn-volt:active:not(:disabled) {
          transform: translateY(0);
        }
        .btn-volt:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .priority-badge {
          font-size: var(--text-2xs);
          text-transform: uppercase;
          font-weight: var(--weight-bold);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }
        .tag-badge {
          font-size: var(--text-2xs);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }
        .timer-btn {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justifyContent: center;
          background: var(--color-surface-2);
          border: 1px solid var(--color-surface-offset);
          color: var(--color-text-base);
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-default);
        }
        .timer-btn:hover {
          background: var(--color-surface-offset);
          border-color: var(--color-balance);
          transform: scale(1.05);
        }
        .timer-btn:active {
          transform: scale(0.95);
        }
        .retro-checkbox {
          width: 20px;
          height: 20px;
          border-radius: var(--radius-sm);
          border: 1.5px solid var(--color-balance);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease-default);
        }
        .retro-checkbox.checked {
          background: var(--color-secondary);
          border-color: var(--color-secondary);
          color: var(--color-text-inverted);
        }
      `}</style>

      {/* STEP 1: SETUP SCREEN */}
      {step === 'setup' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-6)', flex: 1, minHeight: 0 }}>
          {/* Left panel: Task Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Timer style={{ color: 'var(--color-secondary)' }} />
                  <span>Daily Focus Session</span>
                </div>
                <span style={{
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 'var(--weight-bold)',
                  background: selectedTasks.length === 3 ? 'var(--color-secondary-muted)' : 'var(--color-surface-offset)',
                  color: selectedTasks.length === 3 ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                  border: `1px solid ${selectedTasks.length === 3 ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)'
                }}>
                  {selectedTasks.length}/3 selected
                </span>
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>
                Select up to 3 tasks to complete during this interval. Quiet your environment and focus.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingRight: '4px' }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px', color: 'var(--color-text-muted)' }}>
                  Loading uncompleted backlog and board items...
                </div>
              ) : dbItems.length === 0 ? (
                <div style={{ padding: 'var(--space-8)', textAlign: 'center', border: '1px dashed var(--color-surface-offset)', borderRadius: 'var(--radius-lg)', color: 'var(--color-text-muted)' }}>
                  <Award style={{ width: '32px', height: '32px', margin: '0 auto var(--space-3)', opacity: 0.5 }} />
                  <p style={{ fontWeight: 'var(--weight-semibold)' }}>All caught up!</p>
                  <p style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>Add cards or tasks in Backlog/Kanban to pull them here.</p>
                </div>
              ) : (
                dbItems.map(item => {
                  const isSelected = selectedTasks.some(t => t.id === item.id)
                  const priorityLabels = ['None', 'Low', 'Med', 'High']
                  const priorityColors = [
                    'var(--color-priority-none)',
                    'var(--color-priority-low)',
                    'var(--color-priority-med)',
                    'var(--color-priority-high)'
                  ]

                  return (
                    <div
                      key={item.id}
                      className={`task-row ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleToggleTaskSelection(item)}
                    >
                      <div
                        className={`retro-checkbox ${isSelected ? 'checked' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleToggleTaskSelection(item)
                        }}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>{item.title}</div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{
                            fontSize: 'var(--text-2xs)',
                            color: 'var(--color-text-muted)',
                            background: 'var(--color-surface-offset)',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            textTransform: 'capitalize'
                          }}>
                            {item.type}
                          </span>

                          {item.priority > 0 && (
                            <span
                              className="priority-badge"
                              style={{
                                background: priorityColors[item.priority] + '15',
                                color: priorityColors[item.priority]
                              }}
                            >
                              {priorityLabels[item.priority]}
                            </span>
                          )}

                          {item.tags && item.tags.map(tag => (
                            <span
                              key={tag.id}
                              className="tag-badge"
                              style={{
                                background: tag.color + '15',
                                color: tag.color,
                                border: `1px solid ${tag.color}33`
                              }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right panel: Controls & Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Presets Card */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>Timer Config</h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {Object.entries(TIMER_PRESETS).map(([key, val]) => (
                  <button
                    key={key}
                    onClick={() => setPreset(key as TimerPreset)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      background: preset === key ? 'var(--color-surface-offset)' : 'transparent',
                      border: `1px solid ${preset === key ? 'var(--color-balance)' : 'var(--color-surface-offset)'}`,
                      color: preset === key ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: preset === key ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all var(--duration-fast) var(--ease-default)'
                    }}
                  >
                    <span>{val.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                      {Math.round(val.durationMs / 60000)}m
                    </span>
                  </button>
                ))}

                <button
                  onClick={() => setPreset('custom')}
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    background: preset === 'custom' ? 'var(--color-surface-offset)' : 'transparent',
                    border: `1px solid ${preset === 'custom' ? 'var(--color-balance)' : 'var(--color-surface-offset)'}`,
                    color: preset === 'custom' ? 'var(--color-text-base)' : 'var(--color-text-muted)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: preset === 'custom' ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    transition: 'all var(--duration-fast) var(--ease-default)'
                  }}
                >
                  <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Custom Timer</span>
                    {preset === 'custom' && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {customMinutes}m
                      </span>
                    )}
                  </div>

                  {preset === 'custom' && (
                    <input
                      type="range"
                      min="1"
                      max="120"
                      value={customMinutes}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setCustomMinutes(Number(e.target.value))}
                      style={{
                        width: '100%',
                        accentColor: 'var(--color-secondary)',
                        background: 'var(--color-surface-2)',
                        height: '4px',
                        borderRadius: '2px',
                        cursor: 'pointer',
                        marginTop: '4px'
                      }}
                    />
                  )}
                </button>
              </div>

              <button
                className="btn-volt"
                disabled={selectedTasks.length === 0}
                onClick={handleStartSession}
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
              >
                <Play size={16} fill="currentColor" />
                Start Focus Mode
              </button>
            </div>

            {/* History Panel */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minHeight: 0 }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <BookOpen size={14} />
                Recent History
              </h3>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {pastSessions.length === 0 ? (
                  <div style={{ padding: 'var(--space-4) 0', color: 'var(--color-text-faint)', textAlign: 'center', fontSize: 'var(--text-xs)' }}>
                    No sessions logged yet in this context.
                  </div>
                ) : (
                  pastSessions.map(session => {
                    const minutes = Math.round(session.duration_ms / 60000)
                    const date = new Date(session.completed_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                    let taskCount = 0
                    try {
                      taskCount = JSON.parse(session.tasks_json || '[]').length
                    } catch {}

                    return (
                      <div
                        key={session.id}
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-surface-offset)',
                          borderRadius: 'var(--radius-md)',
                          padding: 'var(--space-3)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                          <span style={{ color: 'var(--color-text-base)', fontWeight: 'var(--weight-medium)' }}>
                            {minutes}m Session
                          </span>
                          <span style={{ color: 'var(--color-text-faint)' }}>{date}</span>
                        </div>
                        {session.notes && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                            &ldquo;{session.notes.length > 60 ? `${session.notes.slice(0, 60)}...` : session.notes}&rdquo;
                          </div>
                        )}
                        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-secondary)' }}>
                          {taskCount} {taskCount === 1 ? 'task' : 'tasks'} focused
                        </div>
                      </div>
                    )
                  })
                )}
                {pastSessions.length > 0 && (
                  <button
                    onClick={() => setView('analytics')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-secondary)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 'var(--weight-semibold)',
                      textAlign: 'center',
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-1) 0',
                      alignSelf: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'filter 120ms ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
                    onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                  >
                    View all in Analytics <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: ACTIVE SESSION SCREEN */}
      {step === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, padding: 'var(--space-4)' }}>
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '520px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-6)',
              padding: 'var(--space-6) var(--space-8)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-lg)',
              position: 'relative'
            }}
          >
            {/* Header Row: Preset pills & Cancel button */}
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-4)' }}>
              {/* Preset mode pills */}
              <div style={{ display: 'flex', gap: '6px', background: 'var(--color-surface-2)', padding: '3px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-surface-offset)' }}>
                {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map(pKey => {
                  const pConfig = TIMER_PRESETS[pKey]
                  const isAct = preset === pKey
                  const pColor = pKey === 'focus' ? 'var(--color-secondary)' : (pKey === 'short-break' ? '#10b981' : '#8b5cf6')
                  return (
                    <button
                      key={pKey}
                      onClick={() => {
                        setPreset(pKey)
                        const ms = pConfig.durationMs
                        setTimeLeftMs(ms)
                        setDurationMs(ms)
                        setElapsedTimeMs(0)
                      }}
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-bold)',
                        borderRadius: 'var(--radius-full)',
                        border: 'none',
                        background: isAct ? pColor : 'transparent',
                        color: isAct ? (pKey === 'focus' ? '#0f172a' : '#ffffff') : 'var(--color-text-muted)',
                        cursor: 'pointer',
                        transition: 'all 150ms ease'
                      }}
                    >
                      {pConfig.label}
                    </button>
                  )
                })}
              </div>

              {/* End / Cancel session */}
              <button
                onClick={handleCancelSession}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-medium)',
                  transition: 'all 100ms ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-error)'
                  e.currentTarget.style.borderColor = 'var(--color-error)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                  e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                }}
              >
                <X size={13} />
                End Session
              </button>
            </div>

            {/* Clock Dial & Progress Ring */}
            <div style={{ position: 'relative', width: '250px', height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '10px 0' }}>
              <svg width="250" height="250" style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}>
                {/* Background ring */}
                <circle
                  cx="125"
                  cy="125"
                  r="98"
                  fill="transparent"
                  stroke="var(--color-surface-offset)"
                  strokeWidth="10"
                />
                {/* Active filled ring */}
                <circle
                  role="progressbar"
                  aria-valuenow={Math.round(progressPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Focus timer progress"
                  cx="125"
                  cy="125"
                  r="98"
                  fill="transparent"
                  stroke={activeColor}
                  strokeWidth="10"
                  strokeDasharray={2 * Math.PI * 98}
                  strokeDashoffset={2 * Math.PI * 98 * (1 - (progressPercent / 100))}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.3s ease', filter: `drop-shadow(0 0 8px ${activeColor}50)` }}
                />
              </svg>

              {/* Readout inside Circle */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 'var(--weight-bold)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-widest)',
                  color: activeColor
                }}>
                  {preset === 'focus' ? 'Focus Interval' : preset.replace('-', ' ')}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '40px',
                  fontWeight: 'var(--weight-bold)',
                  color: 'var(--color-text-base)',
                  letterSpacing: '-0.03em',
                  lineHeight: 1
                }}>
                  {formatTime(timeLeftMs)}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-medium)' }}>
                  {isRunning ? 'timer active' : 'paused'}
                </span>
              </div>
            </div>

            {/* Controls Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                onClick={handleResetTimer}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 120ms ease'
                }}
                title="Reset Interval"
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-text-base)'
                  e.currentTarget.style.borderColor = 'var(--color-balance)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                  e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                }}
              >
                <RotateCcw size={18} />
              </button>

              <button
                onClick={handleToggleTimer}
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: activeColor,
                  border: 'none',
                  color: (preset === 'focus' ? '#0f172a' : '#ffffff'),
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 14px ${activeColor}40`,
                  transition: 'all 150ms ease',
                  transform: 'scale(1)'
                }}
                title={isRunning ? 'Pause' : 'Resume'}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                {isRunning ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: '3px' }} />}
              </button>

              <button
                onClick={handleSkipTimer}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 120ms ease'
                }}
                title="Skip Interval / Retrospective"
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-text-base)'
                  e.currentTarget.style.borderColor = 'var(--color-balance)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                  e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                }}
              >
                <SkipForward size={18} />
              </button>
            </div>

            {/* Focus Targets checklist */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)', borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <h4 style={{
                  fontSize: '10px',
                  fontWeight: 'var(--weight-bold)',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 'var(--tracking-wide)',
                  margin: 0
                }}>
                  Current Focus Targets
                </h4>
                <span style={{ fontSize: '10px', color: 'var(--color-secondary)', fontWeight: 'var(--weight-bold)' }}>
                  {selectedTasks.filter(t => t.status === 'done').length} / {selectedTasks.length} Done
                </span>
              </div>

              {selectedTasks.map(task => {
                const isCompleted = task.status === 'done'
                return (
                  <div
                    key={task.id}
                    onClick={() => handleToggleTaskDoneActive(task)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      background: isCompleted ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      cursor: 'pointer',
                      opacity: isCompleted ? 0.6 : 1,
                      transition: 'all var(--duration-fast)'
                    }}
                  >
                    <div className={`retro-checkbox ${isCompleted ? 'checked' : ''}`}>
                      {isCompleted && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-medium)',
                      color: isCompleted ? 'var(--color-text-muted)' : 'var(--color-text-base)',
                      textDecoration: isCompleted ? 'line-through' : 'none'
                    }}>
                      {task.title}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: RETROSPECTIVE SCREEN */}
      {step === 'retro' && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}>
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '540px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-5)',
              padding: 'var(--space-6)'
            }}
          >
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Award />
                Interval Retrospective
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                Verify completed tasks and record any notes about this session.
              </p>
            </div>

            {/* Check completed checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                Verify Completed Tasks
              </h3>
              {retroTasks.length === 0 ? (
                <div style={{ fontStyle: 'italic', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                  No tasks selected for this session.
                </div>
              ) : (
                retroTasks.map(t => (
                  <div
                    key={t.id}
                    onClick={() => handleToggleRetroTask(t.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      cursor: 'pointer'
                    }}
                  >
                    <div className={`retro-checkbox ${t.completed ? 'checked' : ''}`}>
                      {t.completed && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span style={{
                      fontSize: 'var(--text-xs)',
                      color: t.completed ? 'var(--color-text-muted)' : 'var(--color-text-base)',
                      textDecoration: t.completed ? 'line-through' : 'none'
                    }}>
                      {t.title}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Retrospective Text Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label
                htmlFor="retro-notes-area"
                style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}
              >
                What did you accomplish or learn? (Retrospective Notes)
              </label>
              <textarea
                id="retro-notes-area"
                value={retroNotes}
                onChange={e => setRetroNotes(e.target.value)}
                placeholder="Write down any takeaways, obstacles, or design decisions reached during this block..."
                rows={4}
                style={{
                  width: '100%',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-base)',
                  padding: 'var(--space-3)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 'var(--leading-normal)',
                  resize: 'none',
                  outline: 'none',
                  transition: 'border-color var(--duration-fast)'
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-secondary)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <button
                onClick={() => {
                  setShowDiscardConfirm(true)
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-muted)',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-surface-offset)'
                  e.currentTarget.style.color = 'var(--color-error)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                Discard
              </button>

              <button
                onClick={handleSaveRetrospective}
                className="btn-volt"
              >
                <Check size={16} />
                Save & Log Session
              </button>
            </div>
          </div>
        </div>
      )}
        <ConfirmDialog
          isOpen={showCancelConfirm}
          title="Cancel Session"
          message="Cancel this focus session? No progress will be saved."
          confirmText="Yes, Cancel"
          isDestructive
          onConfirm={performCancelSession}
          onCancel={() => setShowCancelConfirm(false)}
        />

        <ConfirmDialog
          isOpen={showDiscardConfirm}
          title="Discard Retrospective"
          message="Discard session statistics and notes?"
          confirmText="Yes, Discard"
          isDestructive
          onConfirm={() => {
            setShowDiscardConfirm(false)
            setSelectedTasks([])
            setRetroNotes('')
            setStep('setup')
            loadFocusData()
          }}
          onCancel={() => setShowDiscardConfirm(false)}
        />
    </div>
  )
}
