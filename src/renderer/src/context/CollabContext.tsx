import { createContext, useContext, type ReactNode } from 'react'
import { useCollabSession, type CollabSession } from '../components/kanban/useCollabSession'

const CollabContext = createContext<CollabSession | null>(null)

export function CollabProvider({ children }: { children: ReactNode }) {
  const session = useCollabSession()
  return (
    <CollabContext.Provider value={session}>
      {children}
    </CollabContext.Provider>
  )
}

/**
 * Access the workspace-level collaboration session.
 * Must be used within a CollabProvider.
 */
export function useCollab(): CollabSession {
  const ctx = useContext(CollabContext)
  if (!ctx) {
    throw new Error('useCollab must be used within a CollabProvider')
  }
  return ctx
}
