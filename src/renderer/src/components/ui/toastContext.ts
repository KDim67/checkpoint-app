/** on its own so a hot reload of Toast.tsx, or of anything it imports, keeps the same context; a new one put every open screen outside its provider */

import { createContext } from 'react'
import type { ToastContextType } from './Toast'

export const ToastContext = createContext<ToastContextType | undefined>(undefined)
