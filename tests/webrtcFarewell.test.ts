import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { closeGracefully, describeChannelError } from '../src/renderer/src/lib/webrtcTransport'

// What the browser hands to onerror, and the only place the reason for a dead
// session is written down. Read wrongly it came out as "Something went wrong",
// which is not a report anybody can act on.
describe('describeChannelError', () => {
  const event = (error: unknown): Event => ({ type: 'error', error }) as unknown as Event

  it('leads with the reason the transport gives', () => {
    expect(describeChannelError(event({ errorDetail: 'sctp-failure', sctpCauseCode: 12 })))
      .toBe('sctp-failure, SCTP cause 12')
  })

  it('adds the text when there is one', () => {
    expect(describeChannelError(event({ errorDetail: 'data-channel-failure', message: 'Channel closed' })))
      .toBe('data-channel-failure: Channel closed')
  })

  it('makes do with only the text', () => {
    expect(describeChannelError(event({ message: 'Channel closed' }))).toBe('Channel closed')
  })

  it('says something even when the event says nothing', () => {
    expect(describeChannelError(event({}))).toBe('The data channel failed.')
    expect(describeChannelError(event(null))).toBe('The data channel failed.')
    expect(describeChannelError({ type: 'error' } as Event)).toBe('The data channel failed.')
  })

  it('does not throw on a shape it has never seen', () => {
    expect(describeChannelError(event({ errorDetail: 7, sctpCauseCode: 'twelve', message: 42 })))
      .toBe('The data channel failed.')
  })
})

// The goodbye message is the one send in the app that is immediately followed
// by the connection going away, so it is the one that gets thrown away if the
// close does not wait for it. Timing, with nothing to observe afterwards, which
// is exactly the kind of thing that breaks quietly.

type Listener = () => void

class FakeChannel {
  readyState: RTCDataChannelState = 'open'
  bufferedAmount = 0
  closeCalls = 0
  private listeners = new Map<string, Listener[]>()

  addEventListener(type: string, fn: Listener, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? () => { this.removeEventListener(type, wrapped); fn() }
      : fn
    const list = this.listeners.get(type) ?? []
    list.push(wrapped)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type)
    if (!list) return
    const at = list.indexOf(fn)
    if (at !== -1) list.splice(at, 1)
  }

  close(): void {
    this.closeCalls++
  }

  /** What the transport would raise once the stream reset has gone through. */
  settleClosed(): void {
    this.readyState = 'closed'
    for (const fn of [...(this.listeners.get('close') ?? [])]) fn()
  }

  get listenerCount(): number {
    return (this.listeners.get('close') ?? []).length
  }
}

const asChannel = (fake: FakeChannel): RTCDataChannel => fake as unknown as RTCDataChannel

/** True once the promise has settled, without awaiting it. */
function watch(promise: Promise<void>): () => boolean {
  let done = false
  void promise.then(() => { done = true })
  return () => done
}

describe('closeGracefully', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('has nothing to wait for on a channel that is already gone', async () => {
    const channel = new FakeChannel()
    channel.readyState = 'closed'
    await closeGracefully(asChannel(channel))
    expect(channel.closeCalls).toBe(0)
  })

  it('closes an already empty channel and waits for it to confirm', async () => {
    const channel = new FakeChannel()
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(0)
    expect(channel.closeCalls).toBe(1)
    expect(settled()).toBe(false)

    channel.settleClosed()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled()).toBe(true)
  })

  it('holds the close until what was queued has gone', async () => {
    const channel = new FakeChannel()
    channel.bufferedAmount = 512
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(60)
    expect(channel.closeCalls).toBe(0)

    channel.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(40)
    expect(channel.closeCalls).toBe(1)

    channel.settleClosed()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled()).toBe(true)
  })

  // A peer that has already gone never reads, so the buffer never empties.
  // Waiting on it forever would hang the disconnect the user just asked for.
  it('gives up on a buffer that never drains', async () => {
    const channel = new FakeChannel()
    channel.bufferedAmount = 4096
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(300)
    expect(settled()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(channel.closeCalls).toBe(1)
    expect(settled()).toBe(true)
  })

  it('gives up on a close that is never confirmed', async () => {
    const channel = new FakeChannel()
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(0)
    expect(channel.closeCalls).toBe(1)
    expect(settled()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled()).toBe(true)
  })

  it('leaves no listener on the channel behind it', async () => {
    const channel = new FakeChannel()
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(0)
    channel.settleClosed()
    await vi.advanceTimersByTimeAsync(1000)

    expect(settled()).toBe(true)
    expect(channel.listenerCount).toBe(0)
  })

  it('stops waiting the moment the channel closes under it', async () => {
    const channel = new FakeChannel()
    channel.bufferedAmount = 4096
    const settled = watch(closeGracefully(asChannel(channel)))

    await vi.advanceTimersByTimeAsync(40)
    channel.readyState = 'closed'
    await vi.advanceTimersByTimeAsync(40)

    expect(settled()).toBe(true)
    expect(channel.closeCalls).toBe(0)
  })
})
