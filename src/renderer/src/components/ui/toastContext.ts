/** on its own so a hot reload of Toast.tsx, or of anything it imports, keeps the same context; a new one put every open screen outside its provider */

import { createContext } from 'react'
import type { ToastContextType, ToastOptions } from './Toast'

export const ToastContext = createContext<ToastContextType | undefined>(undefined)

/** triggers a toast from anywhere via window event */
export function showToast(text: string, options?: ToastOptions): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('checkpoint-toast', { detail: { text, options } }))
  }
}
