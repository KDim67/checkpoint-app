/** fetching where someone else picks the address: every hop checked, and never more read than asked for */

const MAX_REDIRECTS = 5

export interface GuardedInit {
  signal: AbortSignal
  headers: Record<string, string>
}

export interface GuardedDeps {
  fetch: typeof fetch
  /** checked on every hop, a redirect can point anywhere */
  isAllowed: (url: URL) => Promise<boolean>
}

/** walked by hand: fetch's own redirects would skip the address check on every hop after the first */
export async function guardedFetch(
  url: string,
  init: GuardedInit,
  deps: GuardedDeps,
  tag = 'fetch'
): Promise<{ response: Response; finalUrl: string } | null> {
  let current: URL
  try {
    current = new URL(url)
  } catch {
    return null
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null
    if (!(await deps.isAllowed(current))) {
      console.warn(`[${tag}] Refusing to fetch a local or private address:`, current.host)
      return null
    }

    const response = await deps.fetch(current.href, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current.href }

    response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (!location) return null
    try {
      current = new URL(location, current)
    } catch {
      return null
    }
  }
  return null
}

/** stops at the cap, so a huge page or an endless stream can't fill memory */
export async function readCapped(response: Response, cap: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < cap) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    // lets the socket go once we have enough
    reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(Math.min(total, cap))
  let offset = 0
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - offset)
    out.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= out.length) break
  }
  return out
}
