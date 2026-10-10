/** after an update, the notes for what changed since the version last shown, once */

import { useCallback, useEffect, useState } from 'react'
import { compareVersions, whatsNewFor, type ReleaseNote } from '../../../shared/releaseNotes'
import * as appApi from '../data/app'
import { getBoolSetting, getStringSetting, setStringSetting } from './settings'
import { LAST_SEEN_VERSION_KEY, ONBOARDING_SEEN_KEY } from './firstRun'

export interface WhatsNew {
  version: string
  /** newest first */
  releases: ReleaseNote[]
  /** closes it for good, this version counting as seen */
  dismiss: () => void
}

export function useWhatsNew(): WhatsNew | null {
  const [found, setFound] = useState<{ version: string; releases: ReleaseNote[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    const look = async (): Promise<void> => {
      const [current, seen, toured] = await Promise.all([
        appApi.getVersion(),
        getStringSetting(LAST_SEEN_VERSION_KEY, ''),
        getBoolSetting(ONBOARDING_SEEN_KEY, false)
      ])
      // the same version, or back to an older one: nothing new to say
      if (seen && compareVersions(current, seen) <= 0) {
        if (seen !== current) await setStringSetting(LAST_SEEN_VERSION_KEY, current)
        return
      }
      // a first install gets the tour, and counts from here
      if (!seen && !toured) {
        await setStringSetting(LAST_SEEN_VERSION_KEY, current)
        return
      }

      let state = await appApi.releaseNotes()
      // notes kept from before this version came out don't have it yet
      if (!state.releases.some(r => compareVersions(r.version, current) === 0)) state = await appApi.releaseNotes(true)
      if (cancelled) return
      const releases = whatsNewFor(state.releases, { seen, current, toured })
      if (releases.length > 0) setFound({ version: current, releases })
      // unreachable, so next launch tries again; reached with nothing written, so there's nothing to wait for
      else if (!state.error) await setStringSetting(LAST_SEEN_VERSION_KEY, current)
    }
    look().catch(err => console.error('Could not look for what\'s new:', err))
    return () => { cancelled = true }
  }, [])

  const dismiss = useCallback(() => {
    if (!found) return
    setFound(null)
    setStringSetting(LAST_SEEN_VERSION_KEY, found.version).catch(err => console.error('Could not remember the version seen:', err))
  }, [found])

  return found ? { ...found, dismiss } : null
}
