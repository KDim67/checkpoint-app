import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import type { Item, FocusSession } from '../../../../shared/types'
import { durationMsFor, type TimerPreset, type FocusSettings } from './pomodoroTimer'
import { saveFocusDuration, saveLongBreakInterval } from '../../lib/focusSettings'
import { isTypingTarget } from '../../lib/shortcuts'
import { useViewShortcuts } from '../../lib/useViewShortcuts'
import { createItem, itemPage, updateItem } from '../../data/items'
import { createFocusSession, getFocusSessions } from '../../data/focus'

export interface SelectedTask {
  id: string
  title: string
  completed: boolean
}

/**
 * What the focus view reads and does, apart from drawing it.
 *
 * The timer lives in the store and FocusTimerEngine, so a session keeps running
 * while this view is closed. What is here is the task picker, the history, the
 * retrospective and the settings the view edits. The three screens take its
 * return as one prop, the way GameDevView hands each tool to its panel.
 */
export function useFocusView() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()
  const { match: matchKey } = useViewShortcuts('focus')

  // Timer engine state. Lives in the global store (see FocusTimerEngine,
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
      const cardsRes = await itemPage(activeWorkspace, 'card', 1, 100)
      const tasksRes = await itemPage(activeWorkspace, 'task', 1, 100)

      const merged = [...cardsRes.items, ...tasksRes.items].filter(
        item => item.status !== 'done'
      )
      setDbItems(merged)

      // 2. Fetch past focus sessions
      const sessions = await getFocusSessions(activeWorkspace)
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
  }, [activeWorkspace, toast])

  useEffect(() => {
    loadFocusData()
  }, [loadFocusData])

  // The task picker was a one-shot read per workspace, so cards deleted or
  // completed anywhere else went on being offered here until the context
  // changed. These are the same events the board itself reloads on.
  useEffect(() => {
    const refresh = (): void => { loadFocusData() }
    // 'db-mutation' is the one that matters: the preload fires it on every
    // create/update/delete, and archiving a Kanban card is an updateItem, so
    // listening only for the board's own events would miss the exact case this
    // fixes. The other two cover AI- and MCP-driven changes.
    window.addEventListener('db-mutation', refresh)
    window.addEventListener('item-updated', refresh)
    window.addEventListener('kanban-refresh', refresh)
    return () => {
      window.removeEventListener('db-mutation', refresh)
      window.removeEventListener('item-updated', refresh)
      window.removeEventListener('kanban-refresh', refresh)
    }
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
    // next step. A retrospective for focus intervals, or just back to
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

  // Keyboard shortcuts, while a session is running. Which key does what comes
  // from Settings; the defaults are Space, D and R.
  useEffect(() => {
    if (step !== 'active') return
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      switch (matchKey(e)) {
        case 'focus_toggle_timer':
          e.preventDefault()
          handleToggleTimer()
          break
        case 'focus_log_distraction':
          // Quick-tally an interruption without breaking flow (Pomodoro practice)
          if (preset !== 'focus') return
          e.preventDefault()
          focusLogDistraction()
          break
        case 'focus_reset':
          e.preventDefault()
          handleResetTimer()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isRunning, preset, matchKey])

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
      await updateItem(task.id, { status: newStatus })

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
  // view, create it in Backlog/Kanban, then come back. A real friction point
  // for a "jot it down and get back to focusing" workflow.
  const handleQuickAddTask = async () => {
    const title = quickAddText.trim()
    if (!title) return
    setAddingTask(true)
    try {
      const created = await createItem({
        type: 'task',
        context: activeWorkspace,
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
  // "Save & Take a Break". Previously the break shortcut skipped saving
  // entirely, silently losing the retrospective.
  const persistRetrospective = async (): Promise<boolean> => {
    try {
      const selectedTasksJson = JSON.stringify(
        retroTasks.map(t => ({ id: t.id, title: t.title, completed: t.completed }))
      )

      // 1. Write session row to focus_sessions
      await createFocusSession({
        context: activeWorkspace,
        duration_ms: elapsedTimeMs,
        notes: retroNotes.trim(),
        tasks_json: selectedTasksJson
      })

      // 2. Sync database status for any checked retro tasks that were not updated yet
      for (const t of retroTasks) {
        const dbItem = dbItems.find(item => item.id === t.id)
        const expectedStatus = t.completed ? 'done' : 'open'
        if (dbItem && dbItem.status !== expectedStatus) {
          await updateItem(t.id, { status: expectedStatus })
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
      await createItem({
        type: 'log',
        context: activeWorkspace,
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
    // Reset back to setup. Stay on Focus so the user can chain straight
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
    toast('Session saved: enjoy your break', { type: 'success' })
    focusSetSelectedTasks([])
    focusSetPreset(breakPreset)
    focusStart(durationMsFor(focusSettings, breakPreset))
    loadFocusData()
  }

  // Rendering Helper Computations
  const progressPercent = useMemo(() => {
    return durationMs > 0 ? (timeLeftMs / durationMs) * 100 : 0
  }, [timeLeftMs, durationMs])

  // Projected clock time this interval will finish at. Helps plan around it.
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

  return {
    setView,
    step,
    selectedTasks,
    preset,
    customMinutes,
    timeLeftMs,
    isRunning,
    elapsedTimeMs,
    cyclesCompleted,
    focusSettings,
    distractions,
    focusSetPreset,
    focusSetCustomMinutes,
    focusStart,
    focusExitToSetup,
    focusLogDistraction,
    dbItems,
    loading,
    quickAddText,
    setQuickAddText,
    addingTask,
    retroNotes,
    setRetroNotes,
    retroTasks,
    setRetroTasks,
    pastSessions,
    showCancelConfirm,
    setShowCancelConfirm,
    showDiscardConfirm,
    setShowDiscardConfirm,
    loadFocusData,
    handleStartSession,
    handleToggleTimer,
    handleResetTimer,
    handleSkipTimer,
    handleCancelSession,
    performCancelSession,
    handleToggleTaskSelection,
    handleToggleTaskDoneActive,
    handleToggleRetroTask,
    handleQuickAddTask,
    handleSaveRetrospective,
    applyFocusOption,
    handleCadenceChange,
    handleDurationChange,
    handleStartBreak,
    progressPercent,
    projectedEnd,
    longBreakDue,
    activeColor,
    todayStats,
    cycleDots
  }
}

export type FocusViewState = ReturnType<typeof useFocusView>
