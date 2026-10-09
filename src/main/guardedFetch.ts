/** fetching where someone else picks the address: every hop checked, and never more read than asked for */

const MAX_REDIRECTS = 5

export interface GuardedInit {
  signal: AbortSignal
  headers: Record<string, string>
  /** GET when absent */
  method?: string
  body?: string
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

  let request = init
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null
    if (!(await deps.isAllowed(current))) {
      console.warn(`[${tag}] Refusing to fetch an address it may not reach:`, current.host)
      return null
    }

    const response = await deps.fetch(current.href, { ...request, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current.href }

    response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (!location) return null
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      return null
    }
    request = redirected(request, response.status, current, next)
    current = next
  }
  return null
}

/** what a browser sends on after a redirect: 303, or a POST meeting 301 or 302, goes on as a GET with no body */
function redirected(request: GuardedInit, status: number, from: URL, to: URL): GuardedInit {
  const method = (request.method ?? 'GET').toUpperCase()
  const asGet = status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST'
  // credentials meant for one origin never follow a redirect to another
  const headers = from.origin === to.origin
    ? request.headers
    : Object.fromEntries(Object.entries(request.headers).filter(([k]) => k.toLowerCase() !== 'authorization'))
  if (!asGet) return { ...request, headers }
  const rest = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-/i.test(k)))
  return { signal: request.signal, headers: rest, method: 'GET' }
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
