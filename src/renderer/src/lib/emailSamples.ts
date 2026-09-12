/**
 * Loading and saving the user's email writing samples.
 *
 * The database is authoritative: it is what gets backed up, synced between
 * machines and restored. localStorage is a cache and a compatibility path for
 * samples written before the database column existed, so a read falls back to
 * it, and every read that finds the database populated refreshes it.
 */

import {
  formatSamplesForPrompt,
  parseEmailSamples,
  type EmailSample
} from '../../../shared/emailSamples'
import { getSetting, setSetting } from '../data/settings'

const DB_KEY = 'ai_email_writing_samples'
const CACHE_KEY = 'checkpoint_email_writing_samples'
/** The single-string form used before samples became a list. */
const LEGACY_KEY = 'checkpoint_email_writing_style'

function readCache(): EmailSample[] {
  try {
    const cached = parseEmailSamples(localStorage.getItem(CACHE_KEY))
    if (cached.length > 0) return cached

    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy && legacy.trim()) {
      return [{ id: 'sample_1', title: 'Sample Email 1', body: legacy }]
    }
  } catch {}
  return []
}

function writeCache(samples: EmailSample[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(samples))
    // The legacy key is still read by older code paths; keep it pointed at the
    // first sample so they don't fall back to nothing.
    if (samples.length > 0) localStorage.setItem(LEGACY_KEY, samples[0].body)
  } catch {}
}

/**
 * Database first, cache second. This is the fix for a restored database whose
 * samples were invisible because only the cache was ever consulted.
 */
export async function loadEmailSamples(): Promise<EmailSample[]> {
  try {
    const raw = await getSetting(DB_KEY)
    const stored = parseEmailSamples(typeof raw === 'string' ? raw : null)
    if (stored.length > 0) {
      writeCache(stored)
      return stored
    }
  } catch (err) {
    console.warn('Failed to read email samples from the database:', err)
  }
  return readCache()
}

export async function saveEmailSamples(samples: EmailSample[]): Promise<void> {
  writeCache(samples)
  try {
    await setSetting(DB_KEY, JSON.stringify(samples))
  } catch (err) {
    console.warn('Failed to save email samples to the database:', err)
  }
}

/** The prompt block for the current samples, or '' when there are none. */
export async function loadSamplesPromptBlock(): Promise<string> {
  return formatSamplesForPrompt(await loadEmailSamples())
}

export type { EmailSample }
