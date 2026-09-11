/**
 * A quiet sign that a new version is on its way.
 *
 * Lives in the titlebar because the alternative is a dialog, and a dialog over
 * a workspace somebody has had open all day is the thing the updater is written
 * to avoid. It appears only while there is something to report and clicking it
 * opens the panel that reports the rest.
 */

import { Download } from 'lucide-react'
import { useUpdateProgress } from '../../lib/useUpdateProgress'
import { describeUpdateProgress, etaSeconds, etaShort } from '../../../../shared/updateEta'

export default function UpdateIndicator({ onOpen }: { onOpen: () => void }) {
  const progress = useUpdateProgress()
  if (!progress) return null

  const downloading = progress.phase === 'downloading' ? progress : null
  // Clamped because the width of the fill is taken straight from it.
  const percent = downloading ? Math.min(100, Math.max(0, downloading.percent)) : 0
  const eta = downloading ? etaShort(etaSeconds(downloading)) : ''
  const label = downloading ? `${percent}%${eta ? ` · ${eta}` : ''}` : 'Update ready'
  const description = describeUpdateProgress(progress)

  return (
    <button
      className="update-indicator"
      data-ready={downloading ? undefined : ''}
      title={description}
      aria-label={description}
      onClick={onOpen}
    >
      {/* The pill is the progress bar rather than carrying one. A 32px titlebar
          has no room for both, and a bar with no label says even less. */}
      {downloading && <span aria-hidden className="update-indicator-fill" style={{ width: `${percent}%` }} />}
      <span className="update-indicator-body">
        <Download size={11} />
        {label}
      </span>
    </button>
  )
}
