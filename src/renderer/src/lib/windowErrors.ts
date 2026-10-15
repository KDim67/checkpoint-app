/** the window's own failures reach the app log, where a bug report can quote them */

import type { WindowError } from '../../../shared/problemReport'
import { logError } from '../data/app'

/** never throws: reporting a failure mustn't become another one */
export function sendWindowError(error: WindowError): void {
  try {
    logError(error)
  } catch {
    // no bridge: a test, or a page loaded without the preload
  }
}

const described = (reason: unknown): { message: string; stack?: string } =>
  reason instanceof Error ? { message: reason.message || reason.name, stack: reason.stack } : { message: String(reason) }

// chromium raises this when a resize observer's work spills into the next frame; it breaks nothing
const BENIGN = /^ResizeObserver loop/

/** errors nothing else caught; returns the undo */
export function forwardWindowErrors(target: Window = window): () => void {
  const onError = (event: ErrorEvent): void => {
    if (BENIGN.test(event.message)) return
    sendWindowError({ source: 'error', ...described(event.error ?? event.message) })
  }
  const onRejection = (event: PromiseRejectionEvent): void => {
    sendWindowError({ source: 'rejection', ...described(event.reason) })
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
