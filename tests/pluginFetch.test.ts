import { describe, it, expect, vi } from 'vitest'
import { pluginFetch, FETCH_RESPONSE_BYTES } from '../src/main/plugins/pluginFetch'
import { PluginCallError } from '../src/main/plugins/bridge'
import { isPublicHost } from '../src/main/publicAddress'

// a fake DNS where one listed host is public and one name resolves inside the network
const fakeDns = async (host: string) => {
  if (host === 'hooks.example.com' || host === 'other.example.com') return [{ address: '93.184.216.34' }]
  if (host === 'rebind.example.com') return [{ address: '10.0.0.5' }]
  throw new Error('ENOTFOUND')
}

interface Seen { url: string; method: string; body?: string; headers: Record<string, string> }

const run = (routes: Record<string, () => Response>, hosts = ['hooks.example.com', 'rebind.example.com']) => {
  const seen: Seen[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: String(init?.method ?? 'GET'), body: init?.body as string | undefined, headers: (init?.headers ?? {}) as Record<string, string> })
    return routes[url]?.() ?? new Response('', { status: 404 })
  })
  const go = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) =>
    pluginFetch(new URL(url), { headers: {}, ...init }, hosts, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      isPublicHost: hostname => isPublicHost(hostname, fakeDns)
    })
  return { seen, go }
}

const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } })

describe('api.fetch', () => {
  it('returns status, headers and text from a listed host', async () => {
    const { go } = run({ 'https://hooks.example.com/x': () => new Response('hello', { headers: { 'x-a': '1' } }) })
    expect(await go('https://hooks.example.com/x', { method: 'GET' })).toMatchObject({ status: 200, text: 'hello', headers: { 'x-a': '1' } })
  })

  it('refuses a redirect to a host it does not list', async () => {
    const { go, seen } = run({ 'https://hooks.example.com/x': redirect('https://other.example.com/') })
    await expect(go('https://hooks.example.com/x', { method: 'GET' })).rejects.toThrow(PluginCallError)
    expect(seen.map(s => s.url)).toStrictEqual(['https://hooks.example.com/x'])
  })

  it('refuses a listed name that resolves to a private address', async () => {
    const { go, seen } = run({})
    await expect(go('https://rebind.example.com/', { method: 'GET' })).rejects.toThrow(/refused/)
    expect(seen).toHaveLength(0)
  })

  it('refuses a redirect down to plain http', async () => {
    const { go } = run({ 'https://hooks.example.com/x': redirect('http://hooks.example.com/x') })
    await expect(go('https://hooks.example.com/x', { method: 'GET' })).rejects.toThrow(/refused/)
  })

  it('carries a POST through a 303 as a GET with no body, as browsers do', async () => {
    const { go, seen } = run({
      'https://hooks.example.com/post': redirect('https://hooks.example.com/done', 303),
      'https://hooks.example.com/done': () => new Response('ok')
    })
    await go('https://hooks.example.com/post', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })
    expect(seen[1]).toMatchObject({ method: 'GET', body: undefined, headers: {} })
  })

  it('keeps the method and body through a 307', async () => {
    const { go, seen } = run({
      'https://hooks.example.com/post': redirect('https://hooks.example.com/again', 307),
      'https://hooks.example.com/again': () => new Response('ok')
    })
    await go('https://hooks.example.com/post', { method: 'POST', body: 'b' })
    expect(seen[1]).toMatchObject({ method: 'POST', body: 'b' })
  })

  it('drops authorization when a redirect changes origin', async () => {
    const { go, seen } = run({
      'https://hooks.example.com/x': redirect('https://other.example.com/y', 307),
      'https://other.example.com/y': () => new Response('ok')
    }, ['hooks.example.com', 'other.example.com'])
    await go('https://hooks.example.com/x', { method: 'GET', headers: { Authorization: 'Bearer t', 'X-Keep': 'k' } })
    expect(seen[0].headers).toMatchObject({ Authorization: 'Bearer t' })
    expect(seen[1].headers).toStrictEqual({ 'X-Keep': 'k' })
  })

  it('refuses an answer larger than 1 MB', async () => {
    const { go } = run({ 'https://hooks.example.com/big': () => new Response(new Uint8Array(FETCH_RESPONSE_BYTES + 10)) })
    await expect(go('https://hooks.example.com/big', { method: 'GET' })).rejects.toThrow(/larger than 1 MB/)
  })
})
