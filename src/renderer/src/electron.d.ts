/** derived from the preload bridge; the hand-written mirror drifted both ways */
import type { ElectronAPI } from '../../preload'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }

  interface ImportMeta {
    readonly env: {
      readonly DEV: boolean
      readonly PROD: boolean
      readonly MODE: string
      readonly [key: string]: string | boolean | undefined
    }
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag' | 'inherit'
  }
}
