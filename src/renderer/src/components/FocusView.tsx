import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Play, Pause, X, Check, Timer, Award, ArrowRight, BookOpen, RotateCcw, SkipForward, Plus, Flame, Zap, Coffee } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useToast } from './ui/Toast'
import type { Item, FocusSession } from '../../../shared/types'
import { TIMER_PRESETS, formatTime, durationMsFor, type TimerPreset, type FocusSettings } from './focus/pomodoroTimer'
import {
  saveFocusDuration,
  saveLongBreakInterval,
  saveAutoStartNext,
  saveChimeEnabled,
  saveChimeVolume,
  saveNotificationsEnabled
} from '../lib/focusSettings'
import { ToggleSwitch } from './settings/SettingsSection'
import ConfirmDialog from './ui/ConfirmDialog'

interface SelectedTask {
  id: string
  title: string
  completed: boolean
}

function FocusOptionToggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="row-between">
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export default function FocusView() {
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()

  // Timer engine state, lives in the global store (see FocusTimerEngine,
  // mounted at the app root) so a running session survives navigating away
  // from this view entirely, instead of silently resetting.
  const step = useAppStore(s => s.focusStep)
  const selectedTasks = useAppStore(s => s.focusSelectedTasks)
  const preset = useAppStore(s => s.focusPreset)
  const customMinutes = useAppStore(s => s.focusCustomMinutes)
  const durationMs = useAppStore(s => s.focusDurationMs)
  const timeLeftMs = useAppStore(s => s.focusRemainingMs)
  const isRunning = useAppStore(s => s.focusIsRunning)
  const elapsedTimeMs = useAppStore(s => s.focusElapsedMs)
  const cyclesCompleted = useAppStore(s => s.focusCyclesCompleted)
  const focusSettings = useAppStore(s => s.focusSettings)
  const focusApplySettings = useAppStore(s => s.focusApplySettings)
  const distractions = useAppStore(s => s.focusDistractions)

  const focusSetStep = useAppStore(s => s.focusSetStep)
  const focusSetSelectedTasks = useAppStore(s => s.focusSetSelectedTasks)
  const focusSetPreset = useAppStore(s => s.focusSetPreset)
  const focusSetCustomMinutes = useAppStore(s => s.focusSetCustomMinutes)
  const focusConfigureDuration = useAppStore(s => s.focusConfigureDuration)
  const focusStart = useAppStore(s => s.focusStart)
  const focusPauseResume = useAppStore(s => s.focusPauseResume)
  const focusReset = useAppStore(s => s.focusReset)
  const focusFinish = useAppStore(s => s.focusFinish)
  const focusStop = useAppStore(s => s.focusStop)
  const focusExitToSetup = useAppStore(s => s.focusExitToSetup)
  const focusLogDistraction = useAppStore(s => s.focusLogDistraction)

  // Component-local state
  const [dbItems, setDbItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [quickAddText, setQuickAddText] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  // Retrospective State
  const [retroNotes, setRetroNotes] = useState('')
  const [retroTasks, setRetroTasks] = useState<SelectedTask[]>([])
  const [pastSessions, setPastSessions] = useState<FocusSession[]>([])

  // Confirmation dialog states
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

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
          focusSetSelectedTasks([found])
          focusSetPreset('focus')
          focusStart(durationMsFor(useAppStore.getState().focusSettings, 'focus'))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext, toast])

  useEffect(() => {
    loadFocusData()
  }, [loadFocusData])

  // Whenever the global timer engine transitions us into the retro screen
  // (on natural completion or a manual skip), build the checklist from
  // whichever tasks were selected for the session that just ended.
  useEffect(() => {
    if (step === 'retro' && retroTasks.length === 0 && selectedTasks.length > 0) {
      setRetroTasks(
        selectedTasks.map(t => ({
          id: t.id,
          title: t.title,
          completed: t.status === 'done'
        }))
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Timer Setup Helpers
  const getSelectedDurationMs = useCallback(() => {
    if (preset === 'custom') {
      return customMinutes * 60 * 1000
    }
    return durationMsFor(focusSettings, preset)
  }, [preset, customMinutes, focusSettings])

  // Keep the configured duration in sync with the chosen preset while on setup
  useEffect(() => {
    if (step === 'setup') {
      focusConfigureDuration(getSelectedDurationMs())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customMinutes, step])

  const handleStartSession = () => {
    if (selectedTasks.length === 0) {
      toast('Please select at least 1 task to focus on', { type: 'info' })
      return
    }
    focusStart(getSelectedDurationMs())
  }

  const handleToggleTimer = () => focusPauseResume()
  const handleResetTimer = () => focusReset()

  const handleSkipTimer = () => {
    // End the current interval early and move straight to its natural
    // next step, a retrospective for focus intervals, or just back to
    // setup for breaks (mirrors the automatic-completion behavior).
    const isFocus = preset === 'focus'
    focusFinish()
    if (isFocus) {
      setRetroTasks(
        selectedTasks.map(t => ({ id: t.id, title: t.title, completed: t.status === 'done' }))
      )
      focusSetStep('retro')
    } else {
      focusSetStep('setup')
      focusSetPreset('focus')
      focusConfigureDuration(durationMsFor(focusSettings, 'focus'))
    }
  }

  const handleCancelSession = () => setShowCancelConfirm(true)

  const performCancelSession = () => {
    setShowCancelConfirm(false)
    focusStop()
    loadFocusData()
  }

  // Keyboard shortcut: Space to play/pause while a session is active
  useEffect(() => {
    if (step !== 'active') return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target && ['INPUT', 'TEXTAREA'].includes(target.tagName)
      if (isTyping) return
      if (e.code === 'Space') {
        e.preventDefault()
        handleToggleTimer()
      } else if ((e.key === 'd' || e.key === 'D') && preset === 'focus') {
        // Quick-tally an interruption without breaking flow (Pomodoro practice)
        e.preventDefault()
        focusLogDistraction()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        handleResetTimer()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isRunning, preset])

  // Task Selection / Inline Completion
  const handleToggleTaskSelection = (task: Item) => {
    const isSelected = selectedTasks.some(t => t.id === task.id)
    if (isSelected) {
      focusSetSelectedTasks(prev => prev.filter(t => t.id !== task.id))
    } else {
      if (selectedTasks.length >= 3) {
        toast('Focus Mode is optimized for 1-3 tasks at a time.', { type: 'info' })
        return
      }
      focusSetSelectedTasks(prev => [...prev, task])
    }
  }

  const handleToggleTaskDoneActive = async (task: Item) => {
    const isDone = task.status === 'done'
    const newStatus = isDone ? 'open' : 'done'

    try {
      // 1. Update status in Database
      await window.electronAPI.db.updateItem(task.id, { status: newStatus })

      // 2. Update local state
      focusSetSelectedTasks(prev =>
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

  // Quick-add a task directly from the Focus setup screen
  // Previously the only way to get a task into Focus Mode was to leave this
  // view, create it in Backlog/Kanban, then come back, a real friction point
  // for a "jot it down and get back to focusing" workflow.
  const handleQuickAddTask = async () => {
    const title = quickAddText.trim()
    if (!title) return
    setAddingTask(true)
    try {
      const created = await window.electronAPI.db.createItem({
        type: 'task',
        context: activeContext,
        title,
        body: '',
        status: 'open',
        priority: 0,
        position: Date.now(),
        due_at: null,
        metadata: '{}'
      })
      setDbItems(prev => [created, ...prev])
      if (selectedTasks.length < 3) {
        focusSetSelectedTasks(prev => [...prev, created])
      }
      setQuickAddText('')
      toast('Task added and selected for this session', { type: 'success' })
    } catch (err) {
      console.error('Failed to quick-add task:', err)
      toast('Failed to add task', { type: 'error' })
    } finally {
      setAddingTask(false)
    }
  }

  // Save Retrospective Row & Log
  // Shared persistence step used by both "Save & Log Session" and
  // "Save & Take a Break", previously the break shortcut skipped saving
  // entirely, silently losing the retrospective.
  const persistRetrospective = async (): Promise<boolean> => {
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
      const totalMinutes = Math.max(1, Math.round(elapsedTimeMs / 60000))
      const tasksMarkdownList = retroTasks
        .map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`)
        .join('\n')

      const completedCount = retroTasks.filter(t => t.completed).length
      const logBody = `### Focus Session Retrospective 🧘
**Duration:** ${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}
**Preset:** ${preset.replace('-', ' ')}
**Tasks completed:** ${completedCount}/${retroTasks.length}
**Interruptions:** ${distractions}
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

      setRetroNotes('')
      setRetroTasks([])
      return true
    } catch (err) {
      console.error('Failed to save focus session:', err)
      toast('Error saving session details', { type: 'error' })
      return false
    }
  }

  const handleSaveRetrospective = async () => {
    const ok = await persistRetrospective()
    if (!ok) return
    toast('Session retrospective saved to log feed', { type: 'success' })
    // Reset back to setup, stay on Focus so the user can chain straight
    // into a break or another round without losing their place.
    focusExitToSetup()
    loadFocusData()
  }

  const applyFocusOption = (patch: Partial<FocusSettings>, save: Promise<void>) => {
    focusApplySettings({ ...focusSettings, ...patch })
    save.catch(err => console.error('Failed to save focus setting:', err))
  }

  const handleCadenceChange = (value: number) => {
    if (!Number.isFinite(value)) return
    const clamped = Math.min(12, Math.max(2, Math.round(value)))
    applyFocusOption({ longBreakInterval: clamped }, saveLongBreakInterval(clamped))
  }

  const handleDurationChange = (target: TimerPreset, minutes: number) => {
    const next = {
      ...focusSettings,
      durations: { ...focusSettings.durations, [target]: minutes }
    }
    focusApplySettings(next)
    saveFocusDuration(target, minutes).catch(err => {
      console.error('Failed to save focus duration:', err)
    })
  }

  const handleStartBreak = async (breakPreset: Extract<TimerPreset, 'short-break' | 'long-break'>) => {
    const ok = await persistRetrospective()
    if (!ok) return
    toast('Session saved, enjoy your break', { type: 'success' })
    focusSetSelectedTasks([])
    focusSetPreset(breakPreset)
    focusStart(durationMsFor(focusSettings, breakPreset))
    loadFocusData()
  }

  // Rendering Helper Computations
  const progressPercent = useMemo(() => {
    return durationMs > 0 ? (timeLeftMs / durationMs) * 100 : 0
  }, [timeLeftMs, durationMs])

  // Projected clock time this interval will finish at, helps plan around it.
  const projectedEnd = useMemo(() => {
    if (!isRunning) return null
    return new Date(Date.now() + timeLeftMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [isRunning, timeLeftMs])

  // Classic Pomodoro cadence: after every 4th completed focus interval, a
  // long break is due instead of a short one.
  const longBreakDue = cyclesCompleted > 0 && cyclesCompleted % focusSettings.longBreakInterval === 0

  // Context color picker
  const activeColor = preset === 'focus' ? 'var(--color-secondary)' : (preset === 'short-break' ? '#10b981' : '#8b5cf6')

  // Today's focused-minutes stat, derived from recent session history
  const todayStats = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todaySessions = pastSessions.filter(s => s.completed_at >= startOfToday.getTime())
    const totalMs = todaySessions.reduce((sum, s) => sum + s.duration_ms, 0)
    return { count: todaySessions.length, minutes: Math.round(totalMs / 60000) }
  }, [pastSessions])

  const cycleDots = cyclesCompleted % focusSettings.longBreakInterval

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
          transform: translateX(2px);
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
        .btn-ghost {
          background: transparent;
          border: 1px solid var(--color-surface-offset);
          color: var(--color-text-muted);
          border-radius: var(--radius-md);
          padding: 8px 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          transition: all var(--duration-fast) var(--ease-default);
        }
        .btn-ghost:hover {
          border-color: var(--color-balance);
          color: var(--color-text-base);
          background: var(--color-surface-2);
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
          flex-shrink: 0;
        }
        .retro-checkbox.checked {
          background: var(--color-secondary);
          border-color: var(--color-secondary);
          color: var(--color-text-inverted);
        }
        .quick-add-input {
          flex: 1;
          background: var(--color-surface-2);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-md);
          color: var(--color-text-base);
          padding: 8px 12px;
          font-size: var(--text-sm);
          outline: none;
          transition: border-color var(--duration-fast) var(--ease-default);
        }
        .quick-add-input:focus {
          border-color: var(--color-secondary);
        }
        .cycle-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-surface-offset);
          transition: background var(--duration-fast) var(--ease-default);
        }
        .cycle-dot.filled {
          background: var(--color-secondary);
        }
        .timer-ring-active {
          animation: breathe 4s ease-in-out infinite;
        }
      `}</style>

      {/* STEP 1: SETUP SCREEN */}
      {step === 'setup' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-6)', flex: 1, minHeight: 0 }}>
          {/* Left panel: Task Picker */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0 }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div className="row">
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                  Select up to 3 tasks to complete during this interval. Quiet your environment and focus.
                </p>
                {todayStats.count > 0 && (
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: 'var(--text-2xs)',
                    fontWeight: 'var(--weight-bold)',
                    color: 'var(--color-secondary)',
                    whiteSpace: 'nowrap'
                  }}>
                    <Flame size={12} />
                    {todayStats.minutes}m focused today ({todayStats.count} {todayStats.count === 1 ? 'session' : 'sessions'})
                  </span>
                )}
              </div>
            </div>

            {/* Quick-add: jot a task straight into today's focus list without leaving the view */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                className="quick-add-input"
                type="text"
                placeholder="Quick-add a task and focus on it..."
                value={quickAddText}
                onChange={e => setQuickAddText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !addingTask) handleQuickAddTask()
                }}
              />
              <button
                className="btn-ghost"
                onClick={handleQuickAddTask}
                disabled={addingTask || !quickAddText.trim()}
                style={{ opacity: addingTask || !quickAddText.trim() ? 0.5 : 1, cursor: addingTask || !quickAddText.trim() ? 'not-allowed' : 'pointer', padding: '8px 12px' }}
              >
                <Plus size={16} />
              </button>
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
                  <p style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>Add a task above, or pull cards in from Backlog/Kanban.</p>
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
              <div className="row-between">
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', margin: 0 }}>Timer Config</h3>
                {/* Fills one dot per completed focus interval, resetting each time a long break comes due */}
                <div style={{ display: 'flex', gap: '4px' }} title={`${cyclesCompleted} focus intervals completed this session`}>
                  {Array.from({ length: focusSettings.longBreakInterval }, (_, i) => i).map(i => (
                    <span key={i} className={`cycle-dot ${i < cycleDots || (cycleDots === 0 && cyclesCompleted > 0 && i < focusSettings.longBreakInterval) ? 'filled' : ''}`} />
                  ))}
                </div>
              </div>

              <div className="col">
                {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map(key => (
                  <button
                    key={key}
                    onClick={() => focusSetPreset(key)}
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
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                      transition: 'all var(--duration-fast) var(--ease-default)'
                    }}
                  >
                    <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{TIMER_PRESETS[key].label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        {focusSettings.durations[key]}m
                      </span>
                    </div>

                    {preset === key && (
                      <input
                        type="range"
                        min="1"
                        max="120"
                        aria-label={`${TIMER_PRESETS[key].label} length in minutes`}
                        value={focusSettings.durations[key]}
                        onClick={e => e.stopPropagation()}
                        onChange={e => handleDurationChange(key, Number(e.target.value))}
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
                ))}

                <button
                  onClick={() => focusSetPreset('custom')}
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
                      onChange={e => focusSetCustomMinutes(Number(e.target.value))}
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

              <div style={{ borderTop: '1px solid var(--color-surface-offset)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="row-between">
                  <label htmlFor="focus-cadence" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Long break every
                  </label>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <input
                      id="focus-cadence"
                      type="number"
                      min="2"
                      max="12"
                      value={focusSettings.longBreakInterval}
                      onChange={e => handleCadenceChange(Number(e.target.value))}
                      style={{
                        width: '52px',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-surface-offset)',
                        color: 'var(--color-text-base)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px var(--space-2)',
                        fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'right'
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>intervals</span>
                  </div>
                </div>

                <FocusOptionToggle
                  label="Auto-start next interval"
                  checked={focusSettings.autoStartNext}
                  onChange={value => applyFocusOption({ autoStartNext: value }, saveAutoStartNext(value))}
                />
                <FocusOptionToggle
                  label="Chime on completion"
                  checked={focusSettings.chimeEnabled}
                  onChange={value => applyFocusOption({ chimeEnabled: value }, saveChimeEnabled(value))}
                />
                {focusSettings.chimeEnabled && (
                  <div className="row-between">
                    <label htmlFor="focus-volume" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      Chime volume
                    </label>
                    <input
                      id="focus-volume"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(focusSettings.chimeVolume * 100)}
                      onChange={e => {
                        const volume = Number(e.target.value) / 100
                        applyFocusOption({ chimeVolume: volume }, saveChimeVolume(volume))
                      }}
                      style={{ width: '120px', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                    />
                  </div>
                )}
                <FocusOptionToggle
                  label="Desktop notification"
                  checked={focusSettings.notificationsEnabled}
                  onChange={value => applyFocusOption({ notificationsEnabled: value }, saveNotificationsEnabled(value))}
                />
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
            {/* Header Row: Preset pills, cycle dots & Cancel button */}
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: 'var(--space-4)' }}>
              {/* Preset mode pills, locked while running to avoid accidentally nuking progress */}
              <div
                style={{ display: 'flex', gap: '6px', background: 'var(--color-surface-2)', padding: '3px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-surface-offset)', opacity: isRunning ? 0.5 : 1 }}
                title={isRunning ? 'Pause the timer to switch modes' : undefined}
              >
                {(Object.keys(TIMER_PRESETS) as TimerPreset[]).map(pKey => {
                  const pConfig = TIMER_PRESETS[pKey]
                  const isAct = preset === pKey
                  const pColor = pKey === 'focus' ? 'var(--color-secondary)' : (pKey === 'short-break' ? '#10b981' : '#8b5cf6')
                  return (
                    <button
                      key={pKey}
                      disabled={isRunning}
                      onClick={() => {
                        focusSetPreset(pKey)
                        focusStart(durationMsFor(focusSettings, pKey))
                      }}
                      style={{
                        padding: '4px 12px',
                        fontSize: '11px',
                        fontWeight: 'var(--weight-bold)',
                        borderRadius: 'var(--radius-full)',
                        border: 'none',
                        background: isAct ? pColor : 'transparent',
                        color: isAct ? (pKey === 'focus' ? '#0f172a' : '#ffffff') : 'var(--color-text-muted)',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
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
            <div className={isRunning ? 'timer-ring-active' : undefined} style={{ position: 'relative', width: '250px', height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '10px 0' }}>
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
                  {isRunning
                    ? (projectedEnd ? `ends ~${projectedEnd} · Space to pause` : 'Space to pause')
                    : 'paused · Space to resume'}
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

            {/* Distraction tally, a Pomodoro staple: acknowledge the interruption,
                keep working, review the count in the retro. Focus intervals only. */}
            {preset === 'focus' && (
              <button
                onClick={focusLogDistraction}
                title="Log an interruption without breaking focus (press D)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: distractions > 0 ? 'rgba(245, 158, 11, 0.12)' : 'var(--color-surface-2)',
                  border: `1px solid ${distractions > 0 ? 'rgba(245, 158, 11, 0.4)' : 'var(--color-surface-offset)'}`,
                  color: distractions > 0 ? '#f59e0b' : 'var(--color-text-muted)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  cursor: 'pointer',
                  marginTop: 'calc(-1 * var(--space-2))',
                  transition: 'all var(--duration-fast) var(--ease-default)'
                }}
              >
                <Zap size={13} fill={distractions > 0 ? 'currentColor' : 'none'} />
                {distractions === 0
                  ? 'Log a distraction'
                  : `${distractions} distraction${distractions === 1 ? '' : 's'} logged`}
              </button>
            )}

            {/* Focus Targets checklist, hidden for breaks, since there are no tasks to work a break */}
            {preset === 'focus' && (
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

                {selectedTasks.length === 0 ? (
                  <div style={{ fontStyle: 'italic', color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                    No tasks selected for this session.
                  </div>
                ) : (
                  selectedTasks.map(task => {
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
                  })
                )}
              </div>
            )}
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

            {/* At-a-glance session stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              {[
                { label: 'Focused', value: `${Math.max(1, Math.round(elapsedTimeMs / 60000))}m`, color: 'var(--color-secondary)' },
                { label: 'Tasks done', value: `${retroTasks.filter(t => t.completed).length}/${retroTasks.length}`, color: 'var(--color-text-base)' },
                { label: 'Interruptions', value: `${distractions}`, color: distractions > 0 ? '#f59e0b' : 'var(--color-text-base)' }
              ].map(stat => (
                <div
                  key={stat.label}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-surface-offset)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', color: stat.color, lineHeight: 1 }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginTop: '4px' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Long-break cadence nudge, surfaces the classic 4-interval rule */}
            {longBreakDue && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(139, 92, 246, 0.12)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                color: '#a78bfa',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-medium)'
              }}>
                <Coffee size={15} />
                Nice streak, you&rsquo;ve completed {cyclesCompleted} focus intervals. A long break is recommended.
              </div>
            )}

            {/* Check completed checklist */}
            <div className="col">
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
            <div className="col">
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
            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <button
                  className="btn-ghost"
                  onClick={() => handleStartBreak('short-break')}
                  title="Save this session and start a 5-minute break"
                  style={{
                    fontSize: 'var(--text-xs)',
                    borderColor: longBreakDue ? 'var(--color-surface-offset)' : '#10b981',
                    color: longBreakDue ? 'var(--color-text-muted)' : '#10b981'
                  }}
                >
                  <Coffee size={14} /> Short Break · 5m
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => handleStartBreak('long-break')}
                  title="Save this session and start a 15-minute break"
                  style={{
                    fontSize: 'var(--text-xs)',
                    borderColor: longBreakDue ? '#8b5cf6' : 'var(--color-surface-offset)',
                    color: longBreakDue ? '#a78bfa' : 'var(--color-text-muted)'
                  }}
                >
                  <Coffee size={14} /> Long Break · 15m
                </button>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button
                  onClick={() => setShowDiscardConfirm(true)}
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
                  Save &amp; Log Session
                </button>
              </div>
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
            setRetroNotes('')
            setRetroTasks([])
            focusExitToSetup()
            loadFocusData()
          }}
          onCancel={() => setShowDiscardConfirm(false)}
        />
    </div>
  )
}