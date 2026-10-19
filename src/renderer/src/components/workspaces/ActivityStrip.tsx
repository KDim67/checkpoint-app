/** a workspace's days around today: focus done above the line, open work due below it, today marked; hovering a day says what's in it */

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusShare, formatFocus, type Lane, type LaneDay } from '../../../../shared/workspaceLanes'

/** marks stacked under a day before they'd run off the strip; the tooltip lists the rest */
const MARKS = 3
const TIP_ITEMS = 5
/** keeps the tooltip off the window's edge */
const EDGE = 8

const dateOnly = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

function dayName(day: LaneDay): string {
  if (day.offset === 0) return 'Today'
  if (day.offset === -1) return 'Yesterday'
  if (day.offset === 1) return 'Tomorrow'
  return dateOnly.format(new Date(day.day.year, day.day.month, day.day.day))
}

function Tip({ day, anchor }: { day: LaneDay; anchor: DOMRect }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + EDGE, ready: false })

  // measured before it paints: centred on the day, kept inside the window, above the day when below would spill
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - box.width / 2, EDGE), window.innerWidth - box.width - EDGE)
    const below = anchor.bottom + EDGE
    const top = below + box.height > window.innerHeight - EDGE ? anchor.top - box.height - EDGE : below
    setPlace({ left, top, ready: true })
  }, [anchor])

  const shown = day.due.slice(0, TIP_ITEMS)
  return (
    <div ref={ref} className="ws-tip" style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}>
      <div className="ws-tip-date">{dayName(day)}</div>
      {day.offset <= 0 && <div className="ws-tip-muted">{day.focusMs > 0 ? `${formatFocus(day.focusMs)} of focus` : 'No focus'}</div>}
      {shown.map(item => (
        <div key={item.id} className="ws-tip-row">
          <span className={item.late ? 'ws-mark ws-mark-late' : 'ws-mark'} />
          <span className="ws-tip-title">{item.title || 'Untitled'}</span>
          {item.late && <span className="ws-tip-late">late</span>}
        </div>
      ))}
      {day.due.length > TIP_ITEMS && <div className="ws-tip-muted">and {day.due.length - TIP_ITEMS} more</div>}
      {day.offset >= 0 && day.due.length === 0 && <div className="ws-tip-muted">Nothing due</div>}
    </div>
  )
}

/** hidden from screen readers: the lane's own label says the same in words. Always a full lane, empty while loading, so nothing shifts */
export default function ActivityStrip({ lane }: { lane: Lane }): React.JSX.Element {
  const [hovered, setHovered] = useState<{ day: LaneDay; anchor: DOMRect } | null>(null)

  return (
    <div className="ws-strip" aria-hidden="true" onMouseLeave={() => setHovered(null)}>
      <span className="ws-strip-older" title={lane.olderLate ? `${lane.olderLate} late from before these days` : undefined}>
        {lane.olderLate ? `+${lane.olderLate}` : ''}
      </span>
      <div className="ws-days">
        {lane.days.map(day => (
          <span
            key={day.offset}
            className={day.offset === 0 ? 'ws-day ws-day-today' : 'ws-day'}
            data-offset={day.offset}
            onMouseEnter={event => setHovered({ day, anchor: event.currentTarget.getBoundingClientRect() })}
          >
            {day.focusMs > 0 && <span className="ws-day-bar" style={{ '--ws-share': focusShare(day.focusMs) } as React.CSSProperties} />}
            {day.due.length > 0 && (
              <span className="ws-day-marks">
                {day.due.slice(0, MARKS).map(item => <span key={item.id} className={item.late ? 'ws-mark ws-mark-late' : 'ws-mark'} />)}
              </span>
            )}
          </span>
        ))}
      </div>
      {hovered && createPortal(<Tip day={hovered.day} anchor={hovered.anchor} />, document.body)}
    </div>
  )
}
