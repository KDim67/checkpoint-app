/** one link per item, out to the web or across to another item; stored as a string so docs stay plain JSON */

export type WallLink =
  | { type: 'url'; url: string; host: string }
  | { type: 'item'; wallId: string; itemId: string }

// main opens only these, anything else would be a dead chip
const WEB_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

// ids are base36 and dashes, nothing that could smuggle a path
const ITEM_LINK = /^wall:([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/

// arrows and ink have no box to hang a chip on
const LINKABLE = new Set(['note', 'text', 'frame', 'image', 'card', 'doc', 'shape'])

export const isLinkable = (kind: string): boolean => LINKABLE.has(kind)

export const itemLink = (wallId: string, itemId: string): string => `wall:${wallId}/${itemId}`

export function parseWallLink(raw: unknown): WallLink | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null

  const item = ITEM_LINK.exec(text)
  if (item) return { type: 'item', wallId: item[1], itemId: item[2] }

  let url: URL
  try { url = new URL(text) } catch { return null }
  if (!WEB_PROTOCOLS.has(url.protocol)) return null

  if (url.protocol === 'mailto:') {
    return url.pathname ? { type: 'url', url: url.href, host: url.pathname } : null
  }
  if (!url.hostname) return null
  return { type: 'url', url: url.href, host: url.hostname.replace(/^www\./, '') }
}

/** what someone typed into the link field, canonical or null */
export function normalizeLinkInput(input: string): string | null {
  const text = input.trim()
  // an address never has spaces, "my notes" isn't one
  if (!text || /\s/.test(text)) return null

  const direct = parseWallLink(text)
  if (direct) return direct.type === 'item' ? itemLink(direct.wallId, direct.itemId) : direct.url

  // a scheme main won't open stays refused; "host:5173" isn't a scheme
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null

  const guessed = parseWallLink(`https://${text}`)
  // a typed address needs a dot, or "notes" becomes https://notes
  return guessed?.type === 'url' && guessed.host.includes('.') ? guessed.url : null
}

/** explicit only, a pasted "notes.md" is text and not a guess at a domain */
export function pastedLink(text: string): string | null {
  const trimmed = text.trim()
  if (!/^(https?:\/\/|www\.|wall:|mailto:)/i.test(trimmed)) return null
  return normalizeLinkInput(trimmed)
}

// stops at whitespace and quotes; sentence punctuation comes off after
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

/** trailing punctuation belongs to the sentence, a bracket the address opened belongs to it */
function trimTrailing(raw: string): string {
  let end = raw.length
  while (end > 0) {
    const ch = raw[end - 1]
    if ('.,;:!?'.includes(ch)) { end--; continue }
    const open = ch === ')' ? '(' : ch === ']' ? '[' : ch === '}' ? '{' : null
    if (open) {
      const body = raw.slice(0, end)
      if (body.split(ch).length > body.split(open).length) { end--; continue }
    }
    break
  }
  return raw.slice(0, end)
}

/** for drawing note text with its addresses marked */
export function linkSegments(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = []
  let last = 0

  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0
    const raw = trimTrailing(match[0])
    const url = normalizeLinkInput(raw)
    if (!url) continue
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ text: raw, url })
    last = start + raw.length
  }

  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

interface LinkContext {
  activeWallId: string
  wallName: (wallId: string) => string | undefined
  itemLabel: (itemId: string) => string | undefined
  itemExists: (itemId: string) => boolean
}

/** the chip's words; only this wall's items are loaded, so another wall is named by the wall */
export function describeLink(link: string, ctx: LinkContext): { label: string; missing: boolean; external: boolean } {
  const parsed = parseWallLink(link)
  if (!parsed) return { label: 'Broken link', missing: true, external: false }
  if (parsed.type === 'url') return { label: parsed.host, missing: false, external: true }

  if (parsed.wallId === ctx.activeWallId) {
    if (!ctx.itemExists(parsed.itemId)) return { label: 'Deleted item', missing: true, external: false }
    return { label: ctx.itemLabel(parsed.itemId)?.trim() || 'An item on this wall', missing: false, external: false }
  }

  const wall = ctx.wallName(parsed.wallId)
  return wall
    ? { label: wall, missing: false, external: false }
    : { label: 'Deleted wall', missing: true, external: false }
}

/** a copied workspace's walls get new ids, links must follow; the stored JSON comes back untouched if unreadable */
export function remapItemLinks(stored: string, wallIds: Map<string, string>): string {
  let doc: unknown
  try { doc = JSON.parse(stored) } catch { return stored }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return stored

  const items = (doc as { items?: unknown }).items
  if (!Array.isArray(items)) return stored

  let changed = false
  const next = items.map(item => {
    if (!item || typeof item !== 'object') return item
    const parsed = parseWallLink((item as { link?: unknown }).link)
    if (parsed?.type !== 'item') return item
    const to = wallIds.get(parsed.wallId)
    if (!to || to === parsed.wallId) return item
    changed = true
    return { ...item, link: itemLink(to, parsed.itemId) }
  })

  return changed ? JSON.stringify({ ...doc, items: next }) : stored
}
