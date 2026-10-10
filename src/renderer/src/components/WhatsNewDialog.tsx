/** opened once after an update with what changed; loaded only then, so the notes' renderer isn't paid for at every launch */

import type { ReleaseNote } from '../../../shared/releaseNotes'
import { RELEASES_PAGE } from '../../../shared/releaseNotes'
import ModalShell from './ui/ModalShell'
import ReleaseNotesBody, { releaseDate } from './ui/ReleaseNotesBody'
import * as appApi from '../data/app'

export default function WhatsNewDialog({ version, releases, onClose }: {
  version: string
  /** newest first; several when versions were skipped */
  releases: ReleaseNote[]
  onClose: () => void
}): React.JSX.Element {
  const title = `What's new in Checkpoint ${version}`
  return (
    <ModalShell label={title} onClose={onClose} width="var(--whats-new-width)">
      <h2 className="whats-new-title">{title}</h2>
      <div className="whats-new-scroll">
        {releases.map(release => (
          <section key={release.version} className="whats-new-release">
            {releases.length > 1 && (
              <h3 className="whats-new-version">
                {release.version}
                {releaseDate(release.publishedAt) && <span className="whats-new-date">{releaseDate(release.publishedAt)}</span>}
              </h3>
            )}
            <ReleaseNotesBody notes={release.notes} />
          </section>
        ))}
      </div>
      <div className="whats-new-actions">
        <button type="button" className="btn-secondary" onClick={() => void appApi.openExternal(RELEASES_PAGE)}>
          All releases
        </button>
        <button type="button" className="btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </ModalShell>
  )
}
