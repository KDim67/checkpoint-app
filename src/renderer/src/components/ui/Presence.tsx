import React, { useRef } from 'react'
import { PresenceContext, usePresence } from '../../lib/presence'

/** for a dialog or drawer drawn only while open: when show turns false it stays, as it last was, until its exit has played */
export default function Presence({ show, exitMs, children }: { show: boolean; exitMs?: number; children: React.ReactNode }) {
  const { mounted, state } = usePresence(show, exitMs)
  // the parent has usually stopped passing it by now, so the last open frame plays the exit
  const last = useRef(children)
  if (show) last.current = children
  if (!mounted) return null
  return <PresenceContext.Provider value={state}>{show ? children : last.current}</PresenceContext.Provider>
}
