import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { MODE_TITLES, formatTime, isFocusInterval, durationMsFor } from './pomodoroTimer'
import { loadFocusSettings } from '../../lib/focusSettings'
import { reconcileSelectedTasks } from './reconcileTasks'
import { readItems } from '../../data/items'
import * as notificationsApi from '../../data/notifications'

/** mounted at the root so a running timer keeps going on other views; inside FocusView it reset on navigation */
export default function FocusTimerEngine(): null {
  const { toast } = useToast()

  const audioCtxRef = useRef<AudioContext | null>(null)
  // restore the real title after; only touch it on change, not every 250ms tick
  const baseTitleRef = useRef<string>('')
  const titleShownRef = useRef<string | null>(null)

  useEffect(() => {
    const apply = () => {
      loadFocusSettings()
        .then(useAppStore.getState().focusApplySettings)
        .catch(err => console.error('Failed to load focus settings:', err))
    }
    apply()
    window.addEventListener('settings-update-focus', apply)
    return () => window.removeEventListener('settings-update-focus', apply)
  }, [])

  useEffect(() => {
    baseTitleRef.current = document.title
    return () => {
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      if (titleShownRef.current !== null) {
        document.title = baseTitleRef.current
        titleShownRef.current = null
      }
    }
  }, [])

  // drop deleted cards from the session, ticking a dead id threw; lives here since FocusView is unmounted then
  useEffect(() => {
    const reconcile = async (): Promise<void> => {
      const { focusSelectedTasks, activeWorkspace, focusSetSelectedTasks } = useAppStore.getState()
      if (focusSelectedTasks.length === 0) return
      try {
        const [cards, tasks] = await Promise.all([
          readItems(activeWorkspace, 'card'),
          readItems(activeWorkspace, 'task')
        ])
        const live = [...cards, ...tasks]
        const next = reconcileSelectedTasks(focusSelectedTasks, live)
        // same reference when nothing changed, so usually no render
        if (next !== focusSelectedTasks) focusSetSelectedTasks(next)
      } catch (err) {
        // a failed reconcile mustn't disturb a running timer
        console.error('[focus] Could not reconcile selected tasks:', err)
      }
    }

    window.addEventListener('db-mutation', reconcile)
    window.addEventListener('item-updated', reconcile)
    window.addEventListener('kanban-refresh', reconcile)
    return () => {
      window.removeEventListener('db-mutation', reconcile)
      window.removeEventListener('item-updated', reconcile)
      window.removeEventListener('kanban-refresh', reconcile)
    }
  }, [])

  const playChime = (volume: number) => {
    try {
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
        gain.gain.linearRampToValueAtTime(volume, start + 0.05)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        osc.start(start)
        osc.stop(start + duration)
      }
      const now = audioCtx.currentTime
      playTone(523.25, now, 0.25)
      playTone(659.25, now + 0.15, 0.4)
      playTone(783.99, now + 0.3, 0.6)
    } catch (err) {
      console.error('AudioContext chime failed:', err)
    }
  }

  const notifyCompletion = (isFocus: boolean) => {
    // via main for the shared policy and to fire unfocused; no dedupe, two intervals are two things
    notificationsApi.send({
        category: 'focus',
        title: isFocus ? 'Focus interval complete 🧠' : 'Break complete ☕',
        body: isFocus
          ? 'Nice work. Time to log a quick retrospective.'
          : 'Ready to start another focus interval when you are.'
      })
      // never let notifications break the timer
      .catch(err => console.error('Desktop notification failed:', err))
  }

  // subscribed so the interval only exists while a session is on screen
  const focusStep = useAppStore(s => s.focusStep)

  useEffect(() => {
    if (focusStep !== 'active') return

    const interval = setInterval(() => {
      const state = useAppStore.getState()

      // live countdown in document.title, restored on cleanup
      const remainMs = state.focusIsRunning && state.focusEndAt !== null
        ? Math.max(0, state.focusEndAt - Date.now())
        : state.focusRemainingMs
      const nextTitle = `${state.focusIsRunning ? '' : '⏸ '}${formatTime(remainMs)} · ${MODE_TITLES[state.focusPreset]}`
      if (nextTitle !== titleShownRef.current) {
        document.title = nextTitle
        titleShownRef.current = nextTitle
      }

      if (!state.focusIsRunning || state.focusEndAt === null) return

      const remaining = state.focusEndAt - Date.now()
      if (remaining > 0) {
        state.focusTick()
        return
      }

      // focusFinish() nulls focusEndAt, so later ticks short-circuit
      const settings = state.focusSettings
      const isFocus = isFocusInterval(state.focusPreset)
      state.focusFinish()
      if (settings.chimeEnabled) playChime(settings.chimeVolume)
      if (settings.notificationsEnabled) notifyCompletion(isFocus)

      if (isFocus) {
        // focus goes to the retro so progress gets logged
        state.focusSetStep('retro')
        toast('Focus interval complete! Time for a quick retrospective.', { type: 'success' })
      } else {
        // breaks just end, back to setup with Focus preselected
        state.focusSetStep('setup')
        state.focusSetPreset('focus')
        state.focusConfigureDuration(durationMsFor(settings, 'focus'))
        // only on break to focus, or it'd skip the retro
        if (settings.autoStartNext) {
          state.focusStart(durationMsFor(settings, 'focus'))
          toast('Break complete: next focus interval started.', { type: 'info' })
        } else {
          toast('Break complete! Ready for another focus interval whenever you are.', {
            type: 'info'
          })
        }
      }
    }, 250)

    return () => {
      clearInterval(interval)
      if (titleShownRef.current !== null) {
        document.title = baseTitleRef.current
        titleShownRef.current = null
      }
    }
  }, [focusStep, toast])

  return null
}