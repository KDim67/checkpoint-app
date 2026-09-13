/** label only, no behaviour; a joined board used to look like your own */

import { Users } from 'lucide-react'

export default function SharedBadge({ withLabel = false }: { withLabel?: boolean }) {
  return (
    <span className="shared-badge" title="This board has been shared with someone">
      <Users size={10} />
      {withLabel && 'Shared'}
    </span>
  )
}
