import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { MODE_TITLES, formatTime, isFocusInterval, durationMsFor } from './pomodoroTimer'
import { loadFocusSettings } from '../../lib/focusSettings'
import { reconcileSelectedTasks } from './reconcileTasks'

/**
 * Mounted once at the app root (outside FocusView) so a running focus/break
 * timer keeps counting down, and still fires its completion chime,
 * notification, and screen transition, even while the user is on a
 * different view (Kanban, Log, etc). Previously all of this lived inside
 * FocusView's local component state, so navigating away silently paused
 * and then reset the session.
 */
export default function FocusTimerEngine(): null {
  const { toast } = useToast()

  const audioCtxRef = useRef<AudioContext | null>(null)
  // Remember the app's real title so we can restore it once a session ends,
  // and track whether we're currently overriding it (only touch document.title
  // when it actually changes, to avoid thrashing it every 250ms tick).
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

  // Keep the session's task selection in step with the board.
  //
  // The selection is a snapshot of whole Item objects living in the store, so
  // it survives navigating away, which also meant it survived the cards being
  // deleted. A card removed from Kanban stayed in the session list forever, and
  // ticking it called updateItem on a dead id, which throws "Item not found":
  // a task that could be neither completed nor dismissed.
  //
  // This lives here rather than in FocusView because FocusView is unmounted
  // while the user is on the Kanban board doing the deleting.
  useEffect(() => {
    const reconcile = async (): Promise<void> => {
      const { focusSelectedTasks, activeContext, focusSetSelectedTasks } = useAppStore.getState()
      if (focusSelectedTasks.length === 0) return
      try {
        const [cards, tasks] = await Promise.all([
          window.electronAPI.db.getItems(activeContext, 'card', 1, 500),
          window.electronAPI.db.getItems(activeContext, 'task', 1, 500)
        ])
        const live = [...cards.items, ...tasks.items]
        const next = reconcileSelectedTasks(focusSelectedTasks, live)
        // Referentially identical when nothing changed, so this is a no-op
        // render-wise on the vast majority of board mutations.
        if (next !== focusSelectedTasks) focusSetSelectedTasks(next)
      } catch (err) {
        // A failed reconcile must not disturb a running timer; the stale entry
        // simply persists until the next board change.
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
    try {
      if (typeof Notification === 'undefined') return
      const fire = (): void => {
        new Notification(isFocus ? 'Focus interval complete 🧠' : 'Break complete ☕', {
          body: isFocus
            ? 'Nice work, time to log a quick retrospective.'
            : 'Ready to start another focus interval when you are.',
          silent: true
        })
      }
      if (Notification.permission === 'granted') {
        fire()
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
          if (p === 'granted') fire()
        })
      }
    } catch (err) {
      // Notifications aren't essential, never let this break the timer
      console.error('Desktop notification failed:', err)
    }
  }

  // Only ticks while a session is on screen. Subscribing to focusStep rather
  // than reading it inside the tick keeps the interval off the event loop
  // entirely for the rest of the app's lifetime.
  const focusStep = useAppStore(s => s.focusStep)

  useEffect(() => {
    if (focusStep !== 'active') return

    const interval = setInterval(() => {
      const state = useAppStore.getState()

      // Glanceable window/taskbar title
      // Mirror the live countdown into document.title so a backgrounded
      // session is still visible at a glance (e.g. "24:31 · Focus"). The
      // effect cleanup restores it when the session leaves the active step.
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

      // Timer hit zero. focusFinish() nulls focusEndAt, so the guard above
      // short-circuits every later tick, no re-entry flag needed.
      const settings = state.focusSettings
      const isFocus = isFocusInterval(state.focusPreset)
      state.focusFinish()
      if (settings.chimeEnabled) playChime(settings.chimeVolume)
      if (settings.notificationsEnabled) notifyCompletion(isFocus)

      if (isFocus) {
        // Focus intervals route to the retrospective so progress gets logged
        state.focusSetStep('retro')
        toast('Focus interval complete! Time for a quick retrospective.', { type: 'success' })
      } else {
        // Breaks just end, no retrospective needed, hand control back to setup
        // with the mode reset to Focus so the next round is one click away.
        state.focusSetStep('setup')
        state.focusSetPreset('focus')
        state.focusConfigureDuration(durationMsFor(settings, 'focus'))
        // Auto-start applies only to the break→focus edge. Doing it after a
        // focus interval would skip straight past the retrospective, which is
        // the point of routing there.
        if (settings.autoStartNext) {
          state.focusStart(durationMsFor(settings, 'focus'))
          toast('Break complete, next focus interval started.', { type: 'info' })
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