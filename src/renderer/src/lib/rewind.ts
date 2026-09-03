/**
 * Gathering the five streams Rewind joins.
 *
 * The order matters and is not arbitrary: the focus sessions have to be read
 * first, because they define the span everything else is filtered to. Only
 * once there is a sitting is it worth asking the tracker, the clipboard and git
 * for anything, and the tracker query is time-ranged, so it does the narrowing
 * in SQL rather than shipping every row to the renderer.
 *
 * Every stream is optional. The tracker is a feature the user can switch off,
 * a workspace may have no git path, and clipboard capture is its own toggle.
 * A missing stream means a thinner reconstruction, never a failure.
 */

import {
  buildRewind,
  lastSittingFor,
  type Rewind
} from '../../../shared/rewind'
import type { Item } from '../../../shared/types'
import { errorMessage } from '../../../shared/errors'

export interface RewindResult {
  rewind: Rewind
  /** Streams that could not contribute, so the panel can say why it is thin. */
  unavailable: string[]
}

/** The git path recorded for a workspace, if it has one. */
async function gitPathFor(context: string): Promise<string | null> {
  try {
    const raw = await window.electronAPI.db.getSetting('contexts_list')
    if (typeof raw !== 'string' || !raw) return null
    const list = JSON.parse(raw) as { slug: string; gitPath?: string }[]
    return list.find(c => c.slug === context)?.gitPath || null
  } catch {
    return null
  }
}

export async function loadRewind(item: Item): Promise<RewindResult> {
  const unavailable: string[] = []

  const sessions = await window.electronAPI.db.getFocusSessions(item.context).catch(() => [])

  // No sitting means nothing to filter the other streams to, so they are never
  // queried, the panel shows its empty state instead.
  const sitting = lastSittingFor(sessions, item.id)
  if (!sitting) {
    return {
      rewind: buildRewind({
        item, sessions, windows: [], clipboard: [], commits: [], now: Date.now()
      }),
      unavailable
    }
  }

  const [windows, clipboard, commits] = await Promise.all([
    window.electronAPI.tracker
      .getActivityStats(item.context, sitting.start, sitting.end)
      .then(stats => stats.byTitle)
      .catch(err => {
        console.warn('[rewind] activity unavailable:', errorMessage(err))
        unavailable.push('window activity')
        return []
      }),

    window.electronAPI.clipboard.getHistory().catch(err => {
      console.warn('[rewind] clipboard unavailable:', errorMessage(err))
      unavailable.push('clipboard')
      return []
    }),

    gitPathFor(item.context).then(path => {
      if (!path) { unavailable.push('git'); return [] }
      return window.electronAPI.git.getLog(path).catch(err => {
        console.warn('[rewind] git log unavailable:', errorMessage(err))
        unavailable.push('git')
        return []
      })
    })
  ])

  return {
    rewind: buildRewind({ item, sessions, windows, clipboard, commits, now: Date.now() }),
    unavailable
  }
}
