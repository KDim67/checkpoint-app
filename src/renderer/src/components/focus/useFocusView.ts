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

/** the timer lives in the store; this is picker, history, retro and settings, passed as one prop */
export function useFocusView() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()
  const { match: matchKey } = useViewShortcuts('focus')

  // in the global store so a running session survives leaving the view
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

  const [dbItems, setDbItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [quickAddText, setQuickAddText] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  const [retroNotes, setRetroNotes] = useState('')
  const [retroTasks, setRetroTasks] = useState<SelectedTask[]>([])
  const [pastSessions, setPastSessions] = useState<FocusSession[]>([])

  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const loadFocusData = useCallback(async () => {
    setLoading(true)
    try {
      const cardsRes = await itemPage(activeWorkspace, 'card', 1, 100)
      const tasksRes = await itemPage(activeWorkspace, 'task', 1, 100)

      const merged = [...cardsRes.items, ...tasksRes.items].filter(
        item => item.status !== 'done'
      )
      setDbItems(merged)

      const sessions = await getFocusSessions(activeWorkspace)
      setPastSessions(sessions.slice(0, 5)) // top 5 recent

      // a preselected task starts the timer right away
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

  // reload on the same events as the board, the one-shot read kept offering deleted cards
  useEffect(() => {
    const refresh = (): void => { loadFocusData() }
    // db-mutation is the key one since archiving is an updateItem; the others cover AI and MCP
    window.addEventListener('db-mutation', refresh)
    window.addEventListener('item-updated', refresh)
    window.addEventListener('kanban-refresh', refresh)
    return () => {
      window.removeEventListener('db-mutation', refresh)
      window.removeEventListener('item-updated', refresh)
      window.removeEventListener('kanban-refresh', refresh)
    }
  }, [loadFocusData])

  // build the retro checklist from the session's tasks when the engine moves to retro
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

  const getSelectedDurationMs = useCallback(() => {
    if (preset === 'custom') {
      return customMinutes * 60 * 1000
    }
    return durationMsFor(focusSettings, preset)
  }, [preset, customMinutes, focusSettings])

  // keep the duration in step with the preset on setup
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
    // end early and go to the natural next step
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

  // while running; keys come from Settings, default Space, D, R
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
          // tally an interruption without breaking flow
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
      await updateItem(task.id, { status: newStatus })

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

  // jot a task down without leaving Focus
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

  // shared by both save buttons; the break one used to skip saving
  const persistRetrospective = async (): Promise<boolean> => {
    try {
      const selectedTasksJson = JSON.stringify(
        retroTasks.map(t => ({ id: t.id, title: t.title, completed: t.completed }))
      )

      await createFocusSession({
        context: activeWorkspace,
        duration_ms: elapsedTimeMs,
        notes: retroNotes.trim(),
        tasks_json: selectedTasksJson
      })

      // sync checked retro tasks not updated yet
      for (const t of retroTasks) {
        const dbItem = dbItems.find(item => item.id === t.id)
        const expectedStatus = t.completed ? 'done' : 'open'
        if (dbItem && dbItem.status !== expectedStatus) {
          await updateItem(t.id, { status: expectedStatus })
        }
      }

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
    // stay on Focus so the next round or break is one click
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

  const progressPercent = useMemo(() => {
    return durationMs > 0 ? (timeLeftMs / durationMs) * 100 : 0
  }, [timeLeftMs, durationMs])

  // projected finish time
  const projectedEnd = useMemo(() => {
    if (!isRunning) return null
    return new Date(Date.now() + timeLeftMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [isRunning, timeLeftMs])

  // long break after every 4th focus interval
  const longBreakDue = cyclesCompleted > 0 && cyclesCompleted % focusSettings.longBreakInterval === 0

  const activeColor = preset === 'focus' ? 'var(--color-secondary)' : (preset === 'short-break' ? '#10b981' : '#8b5cf6')

  // today's focused minutes, from recent history
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
