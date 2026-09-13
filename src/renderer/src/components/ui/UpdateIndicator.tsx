/** titlebar pill instead of a dialog over an all-day workspace; only while there's news */

import { Download } from 'lucide-react'
import { useUpdateProgress } from '../../lib/useUpdateProgress'
import { describeUpdateProgress, etaSeconds, etaShort } from '../../../../shared/updateEta'
import * as appApi from '../../data/app'

export default function UpdateIndicator({ onOpen }: { onOpen: () => void }) {
  const progress = useUpdateProgress()
  if (!progress) return null

  const downloading = progress.phase === 'downloading' ? progress : null
  // clamped, the fill width comes straight from it
  const percent = downloading ? Math.min(100, Math.max(0, downloading.percent)) : 0
  const eta = downloading ? etaShort(etaSeconds(downloading)) : ''
  const label = downloading ? `${percent}%${eta ? ` · ${eta}` : ''}` : 'Restarting…'
  const description = describeUpdateProgress(progress)

  const handleClick = () => {
    if (progress.phase === 'ready') {
      void appApi.installUpdate()
    } else {
      onOpen()
    }
  }

  return (
    <button
      className="update-indicator"
      data-ready={downloading ? undefined : ''}
      title={description}
      aria-label={description}
      onClick={handleClick}
    >
      {/* the pill is the bar, 32px has no room for both */}
      {downloading && <span aria-hidden className="update-indicator-fill" style={{ width: `${percent}%` }} />}
      <span className="update-indicator-body">
        <Download size={11} />
        {label}
      </span>
    </button>
  )
}
