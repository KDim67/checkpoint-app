/** the patch notes in About: the latest open, earlier ones a click away, the version running marked */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { errorMessage } from '../../../../shared/errors'
import { compareVersions, type ReleaseNote, type ReleaseNotesState } from '../../../../shared/releaseNotes'
import ReleaseNotesBody, { releaseDate } from '../ui/ReleaseNotesBody'
import * as appApi from '../../data/app'

function VersionLine({ release, running }: { release: ReleaseNote; running: string }): React.JSX.Element {
  const date = releaseDate(release.publishedAt)
  const order = running ? compareVersions(release.version, running) : null
  return (
    <span className="whats-new-version">
      {release.version}
      {date && <span className="whats-new-date">{date}</span>}
      {order === 0 && <span className="whats-new-badge">You&apos;re on this version</span>}
      {order !== null && order > 0 && <span className="whats-new-badge" data-newer="">Newer than yours</span>}
    </span>
  )
}

export default function WhatsNew(): React.JSX.Element {
  const [state, setState] = useState<ReleaseNotesState | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState('')

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      setState(await appApi.releaseNotes(force))
    } catch (err) {
      setState(prev => ({ releases: prev?.releases ?? [], fetchedAt: prev?.fetchedAt ?? null, error: errorMessage(err, 'Couldn\'t load the notes.') }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    appApi.getVersion().then(setRunning).catch(() => {})
    void load(false)
  }, [load])

  const [latest, ...earlier] = state?.releases ?? []
  const kept = state?.fetchedAt ? new Date(state.fetchedAt).toLocaleDateString() : ''

  return (
    <section className="whats-new" aria-labelledby="whats-new-heading">
      <div className="whats-new-head">
        <h3 id="whats-new-heading" className="whats-new-heading">What&apos;s new</h3>
        <button
          type="button"
          className="whats-new-refresh"
          title="Check GitHub again"
          aria-label="Check GitHub again"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
        </button>
      </div>

      {state?.error && (
        <p role="status" className="whats-new-status">
          {state.error}{latest && kept ? ` Showing the notes kept on ${kept}.` : ''}
        </p>
      )}
      {!state && loading && <p className="whats-new-status">Loading the notes from GitHub…</p>}
      {state && !latest && !state.error && <p className="whats-new-status">No releases have notes yet.</p>}

      {latest && (
        <article className="whats-new-release">
          <VersionLine release={latest} running={running} />
          <ReleaseNotesBody notes={latest.notes} />
        </article>
      )}

      {earlier.length > 0 && (
        <details className="whats-new-earlier">
          <summary>Earlier versions</summary>
          {earlier.map(release => (
            <details key={release.version} className="whats-new-earlier-release">
              <summary><VersionLine release={release} running={running} /></summary>
              <ReleaseNotesBody notes={release.notes} />
            </details>
          ))}
        </details>
      )}
    </section>
  )
}
