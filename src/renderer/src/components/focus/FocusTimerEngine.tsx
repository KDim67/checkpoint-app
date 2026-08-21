import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { TIMER_PRESETS, MODE_TITLES, formatTime, isFocusInterval } from './pomodoroTimer'

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

  const playChime = () => {
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
        gain.gain.linearRampToValueAtTime(0.2, start + 0.05)
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

  useEffect(() => {
    const interval = setInterval(() => {
      const state = useAppStore.getState()

      // Glanceable window/taskbar title
      // Mirror the live countdown into document.title so a backgrounded
      // session is still visible at a glance (e.g. "24:31 · Focus"). Restore
      // the original title the moment the session leaves the active screen.
      if (state.focusStep === 'active') {
        const remainMs = state.focusIsRunning && state.focusEndAt !== null
          ? Math.max(0, state.focusEndAt - Date.now())
          : state.focusRemainingMs
        const nextTitle = `${state.focusIsRunning ? '' : '⏸ '}${formatTime(remainMs)} · ${MODE_TITLES[state.focusPreset]}`
        if (nextTitle !== titleShownRef.current) {
          document.title = nextTitle
          titleShownRef.current = nextTitle
        }
      } else if (titleShownRef.current !== null) {
        document.title = baseTitleRef.current
        titleShownRef.current = null
      }

      if (!state.focusIsRunning || state.focusEndAt === null) return

      const remaining = state.focusEndAt - Date.now()
      if (remaining > 0) {
        state.focusTick()
        return
      }

      // Timer hit zero. focusFinish() nulls focusEndAt, so the guard above
      // short-circuits every later tick, no re-entry flag needed.
      const isFocus = isFocusInterval(state.focusPreset)
      state.focusFinish()
      playChime()
      notifyCompletion(isFocus)

      if (isFocus) {
        // Focus intervals route to the retrospective so progress gets logged
        state.focusSetStep('retro')
        toast('Focus interval complete! Time for a quick retrospective.', { type: 'success' })
      } else {
        // Breaks just end, no retrospective needed, hand control back to setup
        // with the mode reset to Focus so the next round is one click away.
        state.focusSetStep('setup')
        state.focusSetPreset('focus')
        state.focusConfigureDuration(TIMER_PRESETS.focus.durationMs)
        toast('Break complete! Ready for another focus interval whenever you are.', {
          type: 'info'
        })
      }
    }, 250)

    return () => clearInterval(interval)
  }, [toast])

  return null
}