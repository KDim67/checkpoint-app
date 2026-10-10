/** a connected service's own mark, from Simple Icons, coloured by the stylesheet so each reads on both themes */

import React from 'react'
import { siGithub, siJira, siLinear, siNotion, siObsidian, siTodoist, type SimpleIcon } from 'simple-icons'
import type { ConnectionService } from '../../../../shared/connections'

const MARKS: Record<ConnectionService, SimpleIcon> = {
  github: siGithub,
  todoist: siTodoist,
  linear: siLinear,
  jira: siJira,
  notion: siNotion,
  obsidian: siObsidian
}

export default function ServiceLogo({ service, size = 16 }: { service: ConnectionService; size?: number }): React.JSX.Element {
  return (
    <svg className="service-logo" data-service={service} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={MARKS[service].path} />
    </svg>
  )
}
