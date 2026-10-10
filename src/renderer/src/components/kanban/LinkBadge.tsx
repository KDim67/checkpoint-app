/** a card that follows an outside item: where it lives, its state, anything wrong, and a click to open it there */

import React from 'react'
import { TriangleAlert } from 'lucide-react'
import * as appApi from '../../data/app'
import { SERVICES, type ConnectionLink } from '../../../../shared/connections'
import ServiceLogo from '../ui/ServiceLogo'

/** labels shown on the card itself; the rest are in the tooltip */
const LABELS_SHOWN = 2

function stateWord(link: ConnectionLink): string {
  const info = SERVICES[link.service]
  if (link.state === 'gone') return `no longer ${info.where}`
  if (link.stateName) return link.stateName
  return link.state === 'closed' ? info.closedWord : 'open'
}

/** what it is, as a person would say it: owner/repo#12, ENG-123, or a Todoist task in Groceries */
function nameOf(link: ConnectionLink): string {
  const info = SERVICES[link.service]
  if (link.ref) return link.ref
  if (!info.noun) return link.id
  return `${info.name} ${info.noun}${link.place ? ` in ${link.place}` : ''}`
}

export default function LinkBadge({ link }: { link: ConnectionLink }): React.JSX.Element {
  const info = SERVICES[link.service]
  const ref = link.ref ?? info.shortRef(link.id)
  const said = `${nameOf(link)}, ${stateWord(link)}${link.problem ? `. ${link.problem}` : ''}`
  return (
    <span className="link-badge-group">
      <button
        type="button"
        className="link-badge"
        data-state={link.state}
        data-problem={link.problem ? 'true' : undefined}
        title={`${said}\nOpen ${info.where}`}
        aria-label={`${said}. Open ${info.where}`}
        // its own click, so opening the item doesn't also open the card
        onClick={e => {
          e.stopPropagation()
          void appApi.openExternal(link.url)
        }}
      >
        <ServiceLogo service={link.service} size={10} />
        {ref && <span>{ref}</span>}
        {link.problem && <TriangleAlert size={10} aria-hidden="true" />}
      </button>
      {link.labels.slice(0, LABELS_SHOWN).map(label => (
        <span key={label} className="link-label" title={link.labels.join(', ')}>{label}</span>
      ))}
    </span>
  )
}
