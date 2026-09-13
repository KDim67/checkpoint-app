import {
  DEFAULT_FOCUS_SETTINGS,
  FOCUS_SETTING_KEYS,
  clampMinutes,
  type FocusSettings,
  type TimerPreset
} from '../components/focus/pomodoroTimer'
import { getBoolSetting, getNumberSetting, setBoolSetting, setNumberSetting } from './settings'

export async function loadFocusSettings(): Promise<FocusSettings> {
  const presets = Object.keys(FOCUS_SETTING_KEYS) as TimerPreset[]
  const [minutes, longBreakInterval, autoStartNext, chimeEnabled, chimeVolume, notificationsEnabled] =
    await Promise.all([
      Promise.all(
        presets.map(async p => {
          const fallback = DEFAULT_FOCUS_SETTINGS.durations[p]
          return [p, clampMinutes(await getNumberSetting(FOCUS_SETTING_KEYS[p], fallback), fallback)] as const
        })
      ),
      getNumberSetting('focus_long_break_interval', DEFAULT_FOCUS_SETTINGS.longBreakInterval),
      getBoolSetting('focus_auto_start_next', DEFAULT_FOCUS_SETTINGS.autoStartNext),
      getBoolSetting('focus_chime_enabled', DEFAULT_FOCUS_SETTINGS.chimeEnabled),
      getNumberSetting('focus_chime_volume', DEFAULT_FOCUS_SETTINGS.chimeVolume),
      getBoolSetting('focus_notifications_enabled', DEFAULT_FOCUS_SETTINGS.notificationsEnabled)
    ])

  return {
    durations: Object.fromEntries(minutes) as Record<TimerPreset, number>,
    // below 2 every break is a long break
    longBreakInterval: Math.min(12, Math.max(2, Math.round(longBreakInterval))),
    autoStartNext,
    chimeEnabled,
    chimeVolume: Math.min(1, Math.max(0, chimeVolume)),
    notificationsEnabled
  }
}

export async function saveFocusDuration(preset: TimerPreset, minutes: number): Promise<void> {
  await setNumberSetting(FOCUS_SETTING_KEYS[preset], clampMinutes(minutes, DEFAULT_FOCUS_SETTINGS.durations[preset]))
}

export async function saveLongBreakInterval(value: number): Promise<void> {
  await setNumberSetting('focus_long_break_interval', Math.min(12, Math.max(2, Math.round(value))))
}

export async function saveAutoStartNext(value: boolean): Promise<void> {
  await setBoolSetting('focus_auto_start_next', value)
}

export async function saveChimeEnabled(value: boolean): Promise<void> {
  await setBoolSetting('focus_chime_enabled', value)
}

export async function saveChimeVolume(value: number): Promise<void> {
  await setNumberSetting('focus_chime_volume', Math.min(1, Math.max(0, value)))
}

export async function saveNotificationsEnabled(value: boolean): Promise<void> {
  await setBoolSetting('focus_notifications_enabled', value)
}
