import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import useEscapeKey from '../ui/useEscapeKey'
import { cssVars } from './actions'

interface Props {
  /** a point to open beside, from a click or an element's corner */
  at: { x: number; y: number }
  label: string
  onClose: () => void
  children: React.ReactNode
}

/** a small floating panel kept inside the window; Escape or a click outside closes it */
export default function Popover({ at, label, onClose, children }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(at)
  useEscapeKey(onClose, true)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 12
    setPlace({
      x: Math.max(margin, Math.min(at.x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(at.y, window.innerHeight - height - margin))
    })
  }, [at])

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // the click that opened it is still on its way up
    const timer = setTimeout(() => document.addEventListener('mousedown', away), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', away)
    }
  }, [onClose])

  return (
    <div ref={ref} className="cal-popover" role="dialog" aria-label={label}
      style={cssVars({ '--cal-x': `${place.x}px`, '--cal-y': `${place.y}px` })}>
      {children}
    </div>
  )
}
