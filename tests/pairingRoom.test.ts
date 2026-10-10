import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuestPairingRoom, HostPairing } from '../src/renderer/src/lib/pairingRoom'
import { parseInternetCode, type InternetCode } from '../src/shared/internetPairing'

/** ntfy.sh in memory: a post reaches whoever is subscribed to that topic right now, and is kept by no one */
const broker = vi.hoisted(() => ({
  streams: new Set<{ url: string; closed: boolean; onopen: (() => void) | null; onmessage: ((e: { data: string }) => void) | null }>(),
  posted: [] as { url: string; title: string; body: string }[]
}))

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) {
    broker.streams.add(this)
    queueMicrotask(() => this.onopen?.())
  }
  close(): void {
    this.closed = true
    broker.streams.delete(this)
  }
}

async function fakeFetch(url: string, init: { headers: Record<string, string>; body: string }): Promise<{ status: number }> {
  const title = init.headers.Title
  broker.posted.push({ url, title, body: init.body })
  const topic = url.split('?')[0]
  const frame = JSON.stringify({ event: 'message', title, message: init.body })
  for (const stream of [...broker.streams]) {
    if (stream.url === `${topic}/sse`) queueMicrotask(() => stream.onmessage?.({ data: frame }))
  }
  return { status: 200 }
}

beforeEach(() => {
  broker.streams.clear()
  broker.posted.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', fakeFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const code = (text: string): InternetCode => {
  const parsed = parseInternetCode(text)
  if (!parsed) throw new Error(text)
  return parsed
}

/** lets queued deliveries and the crypto behind them run */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 1))
}

function host(text: string) {
  const offers: { guest: string; details: string }[] = []
  const refused: [number, boolean][] = []
  const errors: unknown[] = []
  const pairing = new HostPairing({
    code: code(text),
    purpose: 'sync',
    onOffer: (guest, details, answer) => {
      offers.push({ guest, details })
      void answer(`host details for ${guest}`)
    },
    onRefused: (failures, spent) => refused.push([failures, spent]),
    onError: err => errors.push(err)
  })
  return { pairing, offers, refused, errors }
}

function guest(text: string, id = 'guest1') {
  const answers: string[] = []
  const errors: string[] = []
  const pairing = new GuestPairingRoom({
    code: code(text),
    purpose: 'sync',
    guest: id,
    offer: Promise.resolve(`guest details from ${id}`),
    onAnswer: details => answers.push(details),
    onError: err => errors.push(err instanceof Error ? err.message : String(err))
  })
  return { pairing, answers, errors }
}

describe('pairing in a public room', () => {
  it('hands each side the other\'s details when both have the same code', async () => {
    const h = host('K7QD-482913')
    await h.pairing.start()
    const g = guest('k7qd 482913')
    await g.pairing.start()
    await settle()
    expect(h.offers).toStrictEqual([{ guest: 'guest1', details: 'guest details from guest1' }])
    expect(g.answers).toStrictEqual(['host details for guest1'])
    expect(g.errors).toStrictEqual([])
  })

  it('posts nothing a watcher could read: no secret, no connection details, nothing kept', async () => {
    const h = host('K7QD-482913')
    await h.pairing.start()
    await guest('K7QD-482913').pairing.start()
    await settle()
    expect(broker.posted.map(p => p.title.split(':')[0])).toStrictEqual(['hello', 'reply', 'offer', 'answer'])
    const everything = broker.posted.map(p => `${p.url} ${p.title} ${p.body} ${atob(p.body)}`).join('\n')
    expect(everything).not.toContain('482913')
    expect(everything).not.toContain('details')
    expect(broker.posted.every(p => p.url.endsWith('?cache=no&firebase=no'))).toBe(true)
  })

  it('refuses a wrong code on both sides', async () => {
    const h = host('K7QD-482913')
    await h.pairing.start()
    const g = guest('K7QD-482914')
    await g.pairing.start()
    await settle()
    expect(h.offers).toStrictEqual([])
    expect(h.refused).toStrictEqual([[1, false]])
    expect(g.errors).toStrictEqual(["The code didn't match. Check it with the other computer and try again."])
  })

  it('stops taking guesses after five, and closes the room', async () => {
    const h = host('K7QD-482913')
    await h.pairing.start()
    for (let i = 0; i < 5; i++) await guest(`K7QD-10000${i}`, `guess${i}`).pairing.start()
    await settle()
    expect(h.refused.at(-1)).toStrictEqual([5, true])
    expect([...broker.streams].some(s => s.url.includes('checkpoint-sync'))).toBe(false)
  })

  it('lets the real guest through after someone forges an offer in its name', async () => {
    const h = host('K7QD-482913')
    await h.pairing.start()
    // the forger waits for the real hello to learn the guest id, then posts an offer of its own first
    const realOffer = Promise.withResolvers<string>()
    const g = new GuestPairingRoom({
      code: code('K7QD-482913'), purpose: 'sync', guest: 'real', offer: realOffer.promise,
      onAnswer: () => {}, onError: () => {}
    })
    await g.start()
    await settle()
    const reply = broker.posted.find(p => p.title === 'reply:real')
    expect(reply).toBeDefined()
    await fakeFetch(broker.posted[0].url, { headers: { Title: 'offer:real' }, body: btoa('x'.repeat(60)) })
    await settle()
    realOffer.resolve('the real details')
    await settle()
    expect(h.refused).toStrictEqual([[1, false]])
    expect(h.offers).toStrictEqual([{ guest: 'real', details: 'the real details' }])
  })
})
