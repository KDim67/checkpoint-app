/** on its own so a hot reload of ConfirmDialog.tsx, or of anything it imports, keeps the same context; a new one put every open screen outside its provider */

import { createContext } from 'react'
import type { ConfirmFn, PickFn } from './ConfirmDialog'

export const ConfirmContext = createContext<{ confirm: ConfirmFn; pick: PickFn } | undefined>(undefined)
