import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboard } from 'electron'
import { configureClipboardWatcher, setClipboardCaptureEnabled } from '../src/main/clipboardWatcher'

// the watcher against a scripted clipboard: each look reads the text, the marks, then the text again

const EXCLUDE = 'ExcludeClipboardContentFromMonitorProcessing'
const realPlatform = process.platform

let text = ''
let marked = false
let recorded: string[] = []

const copy = (next: string, isPrivate = false): void => {
  text = next
  marked = isPrivate
}
const tick = (): void => {
  vi.advanceTimersByTime(1000)
}

beforeEach(() => {
  vi.useFakeTimers()
  // the windows marks, wherever the tests run
  Object.defineProperty(process, 'platform', { value: 'win32' })
  copy('')
  recorded = []
  vi.spyOn(clipboard, 'readText').mockImplementation(() => text)
  vi.spyOn(clipboard, 'has').mockImplementation(format => marked && format === EXCLUDE)
  configureClipboardWatcher(copied => recorded.push(copied))
  setClipboardCaptureEnabled(true)
})

afterEach(() => {
  setClipboardCaptureEnabled(false)
  Object.defineProperty(process, 'platform', { value: realPlatform })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the clipboard watcher', () => {
  it('records an ordinary copy once', () => {
    copy('meeting notes for thursday')
    tick()
    tick()
    expect(recorded).toEqual(['meeting notes for thursday'])
  })

  it('skips a copy its program marked private, however ordinary it looks', () => {
    copy('correct horse battery staple', true)
    tick()
    expect(recorded).toEqual([])
  })

  it('still skips an unmarked copy that looks like a credential', () => {
    copy('Tr0ub4dor&3')
    tick()
    expect(recorded).toEqual([])
  })

  it('never records a password whose marks were read after the next copy replaced it', () => {
    copy('correct horse battery staple', true)
    // something ordinary is copied between reading the password and reading its marks
    vi.mocked(clipboard.has).mockImplementationOnce(() => {
      copy('an ordinary second copy')
      return false
    })
    tick()
    expect(recorded).toEqual([])
    tick()
    expect(recorded).toEqual(['an ordinary second copy'])
  })
})
