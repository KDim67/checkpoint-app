/** focus sessions define the span; every stream is optional, a missing one thins it, never fails it */

import {
  buildRewind,
  lastSittingFor,
  type Rewind
} from '../../../shared/rewind'
import type { Item } from '../../../shared/types'
import { errorMessage } from '../../../shared/errors'
import { getFocusSessions } from '../data/focus'
import * as trackerApi from '../data/tracker'
import * as clipboardApi from '../data/clipboard'
import * as gitApi from '../data/git'
import { getSetting } from '../data/settings'

interface RewindResult {
  rewind: Rewind
  /** so the panel can say why it's thin */
  unavailable: string[]
}

async function gitPathFor(context: string): Promise<string | null> {
  try {
    const raw = await getSetting('contexts_list')
    if (typeof raw !== 'string' || !raw) return null
    const list = JSON.parse(raw) as { slug: string; gitPath?: string }[]
    return list.find(c => c.slug === context)?.gitPath || null
  } catch {
    return null
  }
}

export async function loadRewind(item: Item): Promise<RewindResult> {
  const unavailable: string[] = []

  const sessions = await getFocusSessions(item.context).catch(() => [])

  // no sitting, nothing to filter by, so skip the queries
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
    trackerApi.getActivityStats(item.context, sitting.start, sitting.end)
      .then(stats => stats.byTitle)
      .catch(err => {
        console.warn('[rewind] activity unavailable:', errorMessage(err))
        unavailable.push('window activity')
        return []
      }),

    clipboardApi.getHistory().catch(err => {
      console.warn('[rewind] clipboard unavailable:', errorMessage(err))
      unavailable.push('clipboard')
      return []
    }),

    gitPathFor(item.context).then(path => {
      if (!path) { unavailable.push('git'); return [] }
      return gitApi.getLog(path).catch(err => {
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
