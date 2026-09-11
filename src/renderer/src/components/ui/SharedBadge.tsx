/**
 * Marks a board that has been shared with someone, hosted or joined.
 *
 * A label and nothing else: no behaviour hangs off it. It exists because a
 * workspace holding somebody else's board was indistinguishable from one of
 * your own, which is most of the reason joining one felt alarming.
 */

import { Users } from 'lucide-react'

export default function SharedBadge({ withLabel = false }: { withLabel?: boolean }) {
  return (
    <span className="shared-badge" title="This board has been shared with someone">
      <Users size={10} />
      {withLabel && 'Shared'}
    </span>
  )
}
