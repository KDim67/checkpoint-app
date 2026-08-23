/**
 * Renderer-side ambient types for the preload bridge.
 *
 * `ElectronAPI` is DERIVED from the preload's actual bridge object rather than
 * re-declared here. This file used to carry a ~300-line hand-written mirror of
 * `src/preload/index.ts`, which drifted: `db.renameContext` shipped in the
 * preload but never made it into the mirror, so every call site failed to
 * typecheck against an API that was present at runtime. The reverse, a typed
 * method the preload never implements, would have typechecked cleanly and
 * thrown at runtime. Deriving the type removes both failure modes.
 */
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
