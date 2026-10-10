import React from 'react'
import Popover from './Popover'
import { CALENDAR_LAYERS, type CalendarLayer, type CalendarProblem } from '../../../../shared/calendar'

interface Props {
  at: { x: number; y: number }
  layers: Set<CalendarLayer>
  problems: CalendarProblem[]
  onToggle: (layer: CalendarLayer) => void
  onClose: () => void
}

/** each layer on or off, and why one that failed is empty */
export default function ShowMenu({ at, layers, problems, onToggle, onClose }: Props): React.JSX.Element {
  return (
    <Popover at={at} label="Show on the calendar" onClose={onClose}>
      <div className="cal-show">
        <div className="cal-popover-title">Show</div>
        {CALENDAR_LAYERS.map(layer => {
          const issues = problems.filter(p => p.layer === layer.id)
          return (
            <div key={layer.id} className="cal-show-row">
              <label className="plugin-consent-workspace">
                <input type="checkbox" checked={layers.has(layer.id)} onChange={() => onToggle(layer.id)} />
                <span className="cal-swatch" data-layer={layer.id} aria-hidden="true" />
                <span>{layer.label}</span>
              </label>
              {issues.map((p, i) => <div key={i} className="cal-show-problem">{p.message}</div>)}
            </div>
          )
        })}
      </div>
    </Popover>
  )
}
