/** parsing lives here so writer and reader can't drift again */

export interface EmailSample {
  id: string
  title: string
  body: string
}

export const MAX_EMAIL_SAMPLES = 5

/** safe to render and prompt; empty bodies dropped, they teach nothing */
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

/** from the stored JSON string */
export function parseEmailSamples(json: string | null | undefined): EmailSample[] {
  if (!json) return []
  try {
    return normalizeEmailSamples(JSON.parse(json))
  } catch {
    return []
  }
}

/** the system prompt block */
export function formatSamplesForPrompt(samples: EmailSample[]): string {
  return normalizeEmailSamples(samples)
    .map((s, i) => `--- Sample ${i + 1} (${s.title}) ---\n${s.body}`)
    .join('\n\n')
}
