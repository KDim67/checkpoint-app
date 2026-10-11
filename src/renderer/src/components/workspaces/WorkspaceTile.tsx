/** a workspace's tile: its picture when it has one that loads, otherwise its first letter on its colour */

import React, { useState } from 'react'
import { iconUrl } from '../../lib/workspaceIcon'

interface Props {
  name: string
  color: string
  icon?: string
  /** the bigger preview in the forms */
  large?: boolean
}

export default function WorkspaceTile({ name, color, icon, large }: Props): React.JSX.Element {
  // keyed by the file, so a new picture gets its own chance to load
  const [broken, setBroken] = useState<string | null>(null)
  const picture = icon && broken !== icon ? icon : null
  return (
    <span className={large ? 'ws-spine ws-spine-large' : 'ws-spine'} style={{ '--ws-color': color } as React.CSSProperties} aria-hidden="true">
      {picture ? (
        <img className="ws-spine-image" src={iconUrl(picture)} alt="" draggable={false} onError={() => setBroken(picture)} />
      ) : (
        name.trim().charAt(0).toUpperCase() || '#'
      )}
    </span>
  )
}
