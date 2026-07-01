import { clipboard } from 'electron'

let lastText = ''
let intervalId: NodeJS.Timeout | null = null

/**
 * Starts polling the system clipboard every 1 second.
 * Calls `recordCopyFn` if a new, non-empty text string is detected.
 */
export function startClipboardWatcher(recordCopyFn: (text: string) => void): void {
  // Read initial text to avoid duplicating on startup
  try {
    lastText = clipboard.readText()
  } catch (err) {
    console.error('Failed to read initial clipboard state:', err)
  }

  // Poll system clipboard
  intervalId = setInterval(() => {
    try {
      const currentText = clipboard.readText()
      if (currentText && currentText.trim().length > 0 && currentText !== lastText) {
        lastText = currentText
        recordCopyFn(currentText)
      }
    } catch (err) {
      console.error('Error reading system clipboard:', err)
    }
  }, 1000)
}

/**
 * Stops the clipboard watcher interval.
 */
export function stopClipboardWatcher(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
