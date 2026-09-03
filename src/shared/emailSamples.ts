/**
 * The user's saved email drafts, used to teach the model their writing voice.
 *
 * These lived in localStorage alone for a long time, then gained a database
 * write without the reader following, so a restored or synced database held
 * the samples while the panel that needed them saw nothing. The parsing and
 * formatting are here, pure, so the settings screen that writes them and the
 * chat panel that reads them can't drift apart again.
 */

export interface EmailSample {
  id: string
  title: string
  body: string
}

/** How many the settings UI lets the user keep. */
export const MAX_EMAIL_SAMPLES = 5

/**
 * Accepts anything, a parsed JSON blob, a half-written row, undefined, and
 * returns samples that are safe to render and to put in a prompt. Rows without
 * a body are dropped rather than repaired: an empty sample teaches nothing and
 * only costs prompt tokens.
 */
export function normalizeEmailSamples(raw: unknown): EmailSample[] {
  if (!Array.isArray(raw)) return []

  const out: EmailSample[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Partial<EmailSample>
    const body = typeof row.body === 'string' ? row.body : ''
    if (!body.trim()) continue

    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : `sample_${out.length + 1}`,
      title: typeof row.title === 'string' && row.title.trim() ? row.title : `Sample Email ${out.length + 1}`,
      body
    })
    if (out.length >= MAX_EMAIL_SAMPLES) break
  }
  return out
}

/** Same, but from the JSON string the setting is stored as. */
export function parseEmailSamples(json: string | null | undefined): EmailSample[] {
  if (!json) return []
  try {
    return normalizeEmailSamples(JSON.parse(json))
  } catch {
    return []
  }
}

/** Renders the samples as the block injected into the system prompt. */
export function formatSamplesForPrompt(samples: EmailSample[]): string {
  return normalizeEmailSamples(samples)
    .map((s, i) => `--- Sample ${i + 1} (${s.title}) ---\n${s.body}`)
    .join('\n\n')
}
