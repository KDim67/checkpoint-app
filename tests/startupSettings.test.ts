import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STARTUP_SETTINGS,
  MINIMISED_FLAG,
  normalizeStartupSettings,
  reconcile,
  shouldStartHidden,
  trayVisibilityChanged,
  type StartupSettings
} from '../src/shared/startupSettings'

const settings = (over: Partial<StartupSettings> = {}): StartupSettings => ({
  ...DEFAULT_STARTUP_SETTINGS,
  ...over
})

describe('defaults', () => {
  it('leaves close-to-tray off', () => {
    // closing has always quit, don't change the X silently
    expect(DEFAULT_STARTUP_SETTINGS.closeToTray).toBe(false)
  })

  it('shows the tray icon and does not start with Windows', () => {
    expect(DEFAULT_STARTUP_SETTINGS.showTrayIcon).toBe(true)
    expect(DEFAULT_STARTUP_SETTINGS.openAtLogin).toBe(false)
  })
})

describe('normalizeStartupSettings', () => {
  it('fills everything in from junk', () => {
    expect(normalizeStartupSettings(null)).toEqual(DEFAULT_STARTUP_SETTINGS)
    expect(normalizeStartupSettings('{bad')).toEqual(DEFAULT_STARTUP_SETTINGS)
    expect(normalizeStartupSettings(12)).toEqual(DEFAULT_STARTUP_SETTINGS)
  })

  it('reads a JSON string as well as an object', () => {
    expect(normalizeStartupSettings(JSON.stringify({ openAtLogin: true })).openAtLogin).toBe(true)
  })

  it('ignores non-boolean values rather than coercing them', () => {
    // the string "false" mustn't read as truthy
    expect(normalizeStartupSettings({ openAtLogin: 'false' }).openAtLogin).toBe(false)
    expect(normalizeStartupSettings({ openAtLogin: 1 }).openAtLogin).toBe(false)
  })

  it('does not share the default object with its caller', () => {
    const out = normalizeStartupSettings(null)
    out.openAtLogin = true
    expect(DEFAULT_STARTUP_SETTINGS.openAtLogin).toBe(false)
  })

  it('applies the reconciliation on the way in', () => {
    const out = normalizeStartupSettings({ showTrayIcon: false, closeToTray: true, startMinimised: true })
    expect(out.closeToTray).toBe(false)
    expect(out.startMinimised).toBe(false)
  })
})

describe('reconcile', () => {
  it('leaves a sane combination alone', () => {
    const input = settings({ showTrayIcon: true, closeToTray: true, startMinimised: true })
    expect(reconcile(input)).toEqual(input)
  })

  it('refuses to hide the app when there is nothing to click', () => {
    // both without a tray icon strand a windowless process
    const out = reconcile(settings({ showTrayIcon: false, closeToTray: true, startMinimised: true }))
    expect(out.closeToTray).toBe(false)
    expect(out.startMinimised).toBe(false)
  })

  it('keeps the other settings while correcting', () => {
    const out = reconcile(settings({ showTrayIcon: false, openAtLogin: true, closeToTray: true }))
    expect(out.openAtLogin).toBe(true)
  })
})

describe('trayVisibilityChanged', () => {
  it('is true only when the icon is turned on or off', () => {
    expect(trayVisibilityChanged(settings({ showTrayIcon: true }), settings({ showTrayIcon: false }))).toBe(true)
    expect(trayVisibilityChanged(settings({ openAtLogin: false }), settings({ openAtLogin: true }))).toBe(false)
  })
})

// the helper reading this was never called, so the switch did nothing
describe('shouldStartHidden', () => {
  // argv[0] is the exe
  const argv = (...extra: string[]): string[] => ['Checkpoint.exe', ...extra]

  it('stays hidden when Windows launched it with the flag', () => {
    expect(shouldStartHidden(argv(MINIMISED_FLAG), settings({ showTrayIcon: true }))).toBe(true)
  })

  it('shows a window when the app was opened by hand', () => {
    // no flag means opened by hand
    expect(shouldStartHidden(argv(), settings({ startMinimised: true, showTrayIcon: true }))).toBe(false)
  })

  it('shows a window when there is no tray icon to hide behind', () => {
    // nothing to click otherwise
    expect(shouldStartHidden(argv(MINIMISED_FLAG), settings({ showTrayIcon: false }))).toBe(false)
  })

  it('is not fooled by a flag that merely starts the same way', () => {
    expect(shouldStartHidden(argv('--start-minimised-later'), settings({ showTrayIcon: true }))).toBe(false)
  })

  it('reads the flag wherever it sits in the arguments', () => {
    expect(shouldStartHidden(argv('--other', MINIMISED_FLAG), settings({ showTrayIcon: true }))).toBe(true)
  })

  it('uses the same flag the login item is given', () => {
    // written in one file, read in another
    expect(MINIMISED_FLAG).toBe('--start-minimised')
  })
})
