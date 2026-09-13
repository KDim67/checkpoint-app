/** read here, not in the renderer: its CSP only allows local images, and a page shouldn't see our cookies */

import { decodeHtmlBytes, iconExtension, parseLinkPreview, type PagePreview } from '../shared/linkPreview'
import { isPublicHost } from './publicAddress'

/** a head fits many times over; past this we'd only be reading a body we ignore */
const PAGE_BYTES = 512 * 1024
const ICON_BYTES = 256 * 1024
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5
// some sites refuse a request with no agent
const USER_AGENT = 'Mozilla/5.0 (compatible; CheckpointLinkPreview/1.0)'

interface Deps {
  fetch: typeof fetch
  saveIcon: (bytes: Buffer, extension: string) => Promise<string> | string
  /** a page picks its icon and its redirects, so every address is checked before it's requested */
  isAllowed: (url: URL) => Promise<boolean>
}

const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  saveIcon: async (bytes, extension) => {
    // lazy, the media service pulls in the database
    const { saveBufferToMedia } = await import('./mediaService')
    return saveBufferToMedia(bytes, extension)
  },
  isAllowed: url => isPublicHost(url.hostname)
}

interface RequestInit {
  signal: AbortSignal
  headers: Record<string, string>
}

/** walked by hand: fetch's own redirects would skip the address check on every hop after the first */
async function guardedFetch(url: string, init: RequestInit, deps: Deps): Promise<{ response: Response; finalUrl: string } | null> {
  let current: URL
  try {
    current = new URL(url)
  } catch {
    return null
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null
    if (!(await deps.isAllowed(current))) {
      console.warn('[linkPreview] Refusing to fetch a local or private address:', current.host)
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
async function readCapped(response: Response, cap: number): Promise<Uint8Array> {
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

/** undefined for anything short of a whole, real image */
async function fetchIcon(iconUrl: string, deps: Deps): Promise<string | undefined> {
  try {
    const init = { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': USER_AGENT } }
    // an inline icon is decoded, not requested
    const response = iconUrl.startsWith('data:')
      ? await deps.fetch(iconUrl, init)
      : (await guardedFetch(iconUrl, init, deps))?.response
    if (!response) return undefined
    if (!response.ok) {
      response.body?.cancel().catch(() => {})
      return undefined
    }
    // one past the cap tells a big icon from one that just fits
    const bytes = await readCapped(response, ICON_BYTES + 1)
    if (bytes.byteLength > ICON_BYTES) return undefined
    const extension = iconExtension(bytes, response.headers.get('content-type'))
    return extension ? await deps.saveIcon(Buffer.from(bytes), extension) : undefined
  } catch {
    return undefined
  }
}

/** null when the page can't or mustn't be read; a page with no title or icon is still an answer */
export async function fetchLinkPreview(url: string, deps: Deps = defaultDeps): Promise<PagePreview | null> {
  let fetched: { response: Response; finalUrl: string } | null
  try {
    fetched = await guardedFetch(url, {
      // one budget for the redirects and the body together
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
    }, deps)
  } catch (err) {
    console.warn('[linkPreview] Could not reach', url, err)
    return null
  }
  if (!fetched) return null

  const { response, finalUrl } = fetched
  if (!response.ok) {
    response.body?.cancel().catch(() => {})
    return null
  }

  // relative icons resolve against where the redirects ended
  const favicon = new URL('/favicon.ico', finalUrl).href
  const type = response.headers.get('content-type') ?? ''

  // a pdf or an image has no head to read, the site's icon still tells you where it's from
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
    response.body?.cancel().catch(() => {})
    const icon = await fetchIcon(favicon, deps)
    return icon ? { icon } : {}
  }

  let html: string
  try {
    html = decodeHtmlBytes(await readCapped(response, PAGE_BYTES), type)
  } catch (err) {
    console.warn('[linkPreview] Could not read', url, err)
    return null
  }

  const parsed = parseLinkPreview(html, finalUrl)
  let icon = parsed.iconUrl ? await fetchIcon(parsed.iconUrl, deps) : undefined
  // a named icon that won't load; the site root usually still has one
  if (!icon && parsed.iconUrl !== favicon) icon = await fetchIcon(favicon, deps)

  return {
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(icon ? { icon } : {})
  }
}
