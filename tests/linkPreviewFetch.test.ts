import { describe, it, expect, vi } from 'vitest'
import { fetchLinkPreview } from '../src/main/linkPreview'
import { isPublicHost } from '../src/main/publicAddress'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const page = (html: string, type = 'text/html; charset=utf-8', status = 200): Response =>
  new Response(html, { status, headers: { 'content-type': type } })

const icon = (): Response => new Response(PNG, { headers: { 'content-type': 'image/png' } })

const redirect = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { location } })

/** one public site on a fake DNS; the real address policy judges everything */
const fakeDns = async (host: string) => {
  if (host === 'example.com') return [{ address: '93.184.216.34' }]
  throw new Error('ENOTFOUND')
}
const realPolicy = (url: URL): Promise<boolean> => isPublicHost(url.hostname, fakeDns)

/** answers by address, anything else is a 404 */
const fakeFetch = (routes: Record<string, () => Response>) =>
  vi.fn(async (input: string | URL | Request) => {
    const address = input instanceof Request ? input.url : String(input)
    const route = routes[address]
    return route ? route() : new Response('', { status: 404 })
  })

const deps = (routes: Record<string, () => Response>) => {
  const fetch = fakeFetch(routes)
  const saveIcon = vi.fn(async (_bytes: Buffer, extension: string) => `saved.${extension}`)
  return {
    fetch,
    saveIcon,
    deps: { fetch: fetch as unknown as typeof globalThis.fetch, saveIcon, isAllowed: realPolicy }
  }
}

const requested = (fetch: ReturnType<typeof fakeFetch>): string[] => fetch.mock.calls.map(([input]) => String(input))

describe('fetchLinkPreview', () => {
  it('reads the title and description and saves the icon the page names', async () => {
    const { saveIcon, deps: d } = deps({
      'https://example.com/post': () => page('<head><title>Post</title><meta name="description" content="About it"><link rel="icon" href="/i.png"></head>'),
      'https://example.com/i.png': icon
    })

    expect(await fetchLinkPreview('https://example.com/post', d)).toEqual({
      title: 'Post', description: 'About it', icon: 'saved.png'
    })
    expect(saveIcon).toHaveBeenCalledWith(expect.any(Buffer), 'png')
  })

  it('tries the site favicon when the named icon will not load', async () => {
    const { deps: d } = deps({
      'https://example.com/post': () => page('<title>Post</title><link rel="icon" href="/gone.png">'),
      'https://example.com/favicon.ico': icon
    })
    expect(await fetchLinkPreview('https://example.com/post', d)).toEqual({ title: 'Post', icon: 'saved.png' })
  })

  it('still gives the title when there is no icon anywhere', async () => {
    const { saveIcon, deps: d } = deps({
      'https://example.com/post': () => page('<title>Post</title>')
    })
    expect(await fetchLinkPreview('https://example.com/post', d)).toEqual({ title: 'Post' })
    expect(saveIcon).not.toHaveBeenCalled()
  })

  it('never saves something that is not an image, like a page served as the favicon', async () => {
    const { saveIcon, deps: d } = deps({
      'https://example.com/post': () => page('<title>Post</title>'),
      'https://example.com/favicon.ico': () => page('<!doctype html><title>Log in</title>')
    })
    expect(await fetchLinkPreview('https://example.com/post', d)).toEqual({ title: 'Post' })
    expect(saveIcon).not.toHaveBeenCalled()
  })

  it('refuses a non-web address without reaching out at all', async () => {
    const { fetch, deps: d } = deps({})
    expect(await fetchLinkPreview('file:///C:/Windows/win.ini', d)).toBeNull()
    expect(await fetchLinkPreview('mailto:hello@example.com', d)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null for a page that fails or cannot be reached', async () => {
    const { deps: failing } = deps({ 'https://example.com/post': () => page('oops', 'text/html', 500) })
    expect(await fetchLinkPreview('https://example.com/post', failing)).toBeNull()

    const offline = {
      fetch: vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof globalThis.fetch,
      saveIcon: vi.fn(async () => 'never'),
      isAllowed: realPolicy
    }
    expect(await fetchLinkPreview('https://example.com/post', offline)).toBeNull()
  })

  it('does not read a pdf as a page, but still finds the site icon', async () => {
    const { deps: d } = deps({
      'https://example.com/paper.pdf': () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
      'https://example.com/favicon.ico': icon
    })
    expect(await fetchLinkPreview('https://example.com/paper.pdf', d)).toEqual({ icon: 'saved.png' })
  })

  it('stops reading a page that never ends', async () => {
    const chunk = new TextEncoder().encode(`<title>Endless</title>${'x'.repeat(64 * 1024)}`)
    const endless = () => new Response(
      new ReadableStream({ pull(controller) { controller.enqueue(chunk) } }),
      { headers: { 'content-type': 'text/html' } }
    )
    const { deps: d } = deps({ 'https://example.com/stream': endless })

    expect(await fetchLinkPreview('https://example.com/stream', d)).toEqual({ title: 'Endless' })
  })

  it('follows redirects between public addresses and reads the page it lands on', async () => {
    const { deps: d } = deps({
      'https://example.com/old': () => redirect('/new', 301),
      'https://example.com/new': () => page('<title>Moved</title><link rel="icon" href="i.png">'),
      'https://example.com/i.png': icon
    })
    expect(await fetchLinkPreview('https://example.com/old', d)).toEqual({ title: 'Moved', icon: 'saved.png' })
  })

  it('refuses an address on this machine or its network without requesting it', async () => {
    const { fetch, deps: d } = deps({})
    for (const address of [
      'http://localhost:9988/hook', 'http://127.0.0.1:9990/', 'http://192.168.1.1/',
      'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://2130706433/'
    ]) {
      expect(await fetchLinkPreview(address, d), address).toBeNull()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops at a redirect into the local network, before following it', async () => {
    const { fetch, deps: d } = deps({
      'https://example.com/go': () => redirect('http://169.254.169.254/latest/meta-data/')
    })
    expect(await fetchLinkPreview('https://example.com/go', d)).toBeNull()
    expect(requested(fetch)).toEqual(['https://example.com/go'])
  })

  it('never requests an icon a page points into the local network, and keeps the title', async () => {
    const { fetch, deps: d } = deps({
      'https://example.com/post': () => page('<title>Post</title><link rel="icon" href="http://192.168.1.1/reboot.png">')
    })
    expect(await fetchLinkPreview('https://example.com/post', d)).toEqual({ title: 'Post' })
    expect(requested(fetch).some(address => address.includes('192.168.1.1'))).toBe(false)
  })

  it('gives up on a redirect loop', async () => {
    const { fetch, deps: d } = deps({
      'https://example.com/a': () => redirect('/b'),
      'https://example.com/b': () => redirect('/a')
    })
    expect(await fetchLinkPreview('https://example.com/a', d)).toBeNull()
    // the first request plus five redirects, then it stops
    expect(fetch).toHaveBeenCalledTimes(6)
  })
})
