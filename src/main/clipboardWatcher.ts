import { clipboard } from 'electron'
import { looksLikeSecret } from '../shared/clipboardPrivacy'

let lastText = ''
let intervalId: NodeJS.Timeout | null = null
let recordCopy: ((text: string) => void) | null = null

/** separate from start/stop so setSetting can flip it without db reaching into index.ts */
export function configureClipboardWatcher(recordCopyFn: (text: string) => void): void {
  recordCopy = recordCopyFn
}

function startClipboardWatcher(recordCopyFn?: (text: string) => void): void {
  if (recordCopyFn) recordCopy = recordCopyFn
  // a second start would orphan the interval and double-record
  if (intervalId) return

  // seed so whatever was copied before start isn't recorded
  try {
    lastText = clipboard.readText()
  } catch (err) {
    console.error('Failed to read initial clipboard state:', err)
  }

  intervalId = setInterval(() => {
    try {
      const currentText = clipboard.readText()
      if (currentText && currentText.trim().length > 0 && currentText !== lastText) {
        // mark seen either way or a skipped secret gets rechecked every second
        lastText = currentText
        // windows doesn't flag secret copies, so this guesses (see shared/clipboardPrivacy)
        if (!looksLikeSecret(currentText)) recordCopy?.(currentText)
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

/** without this, turning the feature off still recorded every copy */
export function setClipboardCaptureEnabled(enabled: boolean): void {
  if (enabled) {
    startClipboardWatcher()
  } else {
    stopClipboardWatcher()
  }
}
