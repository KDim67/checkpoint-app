import { clipboard } from 'electron'

let lastText = ''
let intervalId: NodeJS.Timeout | null = null
let recordCopy: ((text: string) => void) | null = null

/**
 * Registers the sink for captured copies. Kept separate from start/stop so the
 * enabled flag can be flipped from setSetting without db.ts having to reach
 * back into main/index.ts for the callback.
 */
export function configureClipboardWatcher(recordCopyFn: (text: string) => void): void {
  recordCopy = recordCopyFn
}

export function startClipboardWatcher(recordCopyFn?: (text: string) => void): void {
  if (recordCopyFn) recordCopy = recordCopyFn
  // Starting twice would orphan the first interval and double-record every copy.
  if (intervalId) return

  // Seed from the current clipboard so whatever was already copied before the
  // watcher started is not recorded as a fresh capture.
  try {
    lastText = clipboard.readText()
  } catch (err) {
    console.error('Failed to read initial clipboard state:', err)
  }

  intervalId = setInterval(() => {
    try {
      const currentText = clipboard.readText()
      if (currentText && currentText.trim().length > 0 && currentText !== lastText) {
        lastText = currentText
        recordCopy?.(currentText)
      }
    } catch (err) {
      console.error('Error reading system clipboard:', err)
    }
  }, 1000)
}

export function stopClipboardWatcher(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * Mirrors the Clipboard feature toggle. Without this the watcher ran for the
 * whole session regardless of the setting, so turning the feature off hid the
 * view but kept writing every copy to the history table.
 */
export function setClipboardCaptureEnabled(enabled: boolean): void {
  if (enabled) {
    startClipboardWatcher()
  } else {
    stopClipboardWatcher()
  }
}
