/**
 * Framing and flow control for RTCDataChannel. Two hard limits make a naive
 * `channel.send(JSON.stringify(msg))` unsafe, and both were hit in practice:
 *
 *  1. SCTP caps one message at 256 KB. Exceeding it is not a catchable error:
 *     it raises `Failure to send data` and tears the connection down. The
 *     database payload passes that on any non-trivial install.
 *  2. The send queue is bounded at 16 MB. Overrunning it throws "send queue is
 *     full" and messages are then lost silently: 389 of 400 chunks arrived.
 *
 * Send through `sendFramed`, receive through `FrameAssembler`, and neither
 * limit is reachable from application code.
 */

import { STUN_SERVERS, turnIceServer, type IceServer } from '../../../shared/iceConfig'
import { getStringSetting } from './settings'

/** Where a user's own relay is kept. Never synced, and encrypted at rest. */
export const TURN_URL_KEY = 'turn_url'
export const TURN_USERNAME_KEY = 'turn_username'
export const TURN_CREDENTIAL_KEY = 'turn_credential'

/**
 * Payload bytes per frame. Well under the 256 KB ceiling so the JSON envelope,
 * the relative path and base64 expansion all still fit with room to spare.
 */
const FRAME_PAYLOAD_LIMIT = 48 * 1024

/**
 * Pause sending once this much sits unflushed, and resume when the channel
 * drains below it. Chromium's ceiling is 16 MB; staying an order of magnitude
 * under keeps latency low and leaves headroom for anything the application
 * sends out-of-band while a transfer is in flight.
 */
const BUFFER_HIGH_WATER = 1024 * 1024
const BUFFER_LOW_WATER = 256 * 1024

/** How long to wait for a congested channel before giving up on a send. */
const DRAIN_TIMEOUT_MS = 30_000

export interface Frame {
  __frame: true
  id: string
  index: number
  total: number
  body: string
}

function isFrame(msg: unknown): msg is Frame {
  return typeof msg === 'object' && msg !== null && (msg as Frame).__frame === true
}

/**
 * Resolves once the channel has drained below the low-water mark. Rejects if
 * the channel closes or stays congested past the timeout, so a stalled peer
 * surfaces as an error instead of hanging the transfer forever.
 */
function waitForDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount < BUFFER_HIGH_WATER) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel.removeEventListener('bufferedamountlow', onLow)
      channel.removeEventListener('close', onClose)
      if (err) reject(err)
      else resolve()
    }
    const onLow = (): void => finish()
    const onClose = (): void => finish(new Error('Data channel closed while sending'))
    const timer = setTimeout(
      () => finish(new Error(`Peer stopped reading (${channel.bufferedAmount} bytes stuck)`)),
      DRAIN_TIMEOUT_MS
    )

    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER
    channel.addEventListener('bufferedamountlow', onLow)
    channel.addEventListener('close', onClose)
  })
}

/**
 * Sends a message of any size, splitting it into frames when needed and
 * respecting the send queue. Small messages go out as-is so the common case
 * carries no framing overhead.
 */
export async function sendFramed(channel: RTCDataChannel, msg: unknown): Promise<void> {
  if (channel.readyState !== 'open') {
    throw new Error(`Cannot send on a ${channel.readyState} data channel`)
  }

  const serialized = JSON.stringify(msg)

  if (serialized.length <= FRAME_PAYLOAD_LIMIT) {
    await waitForDrain(channel)
    channel.send(serialized)
    return
  }

  const total = Math.ceil(serialized.length / FRAME_PAYLOAD_LIMIT)
  // Random id rather than a counter: both peers frame concurrently over the
  // same channel, and a shared counter would collide across directions.
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  for (let index = 0; index < total; index++) {
    await waitForDrain(channel)
    if (channel.readyState !== 'open') {
      throw new Error('Data channel closed mid-transfer')
    }
    const body = serialized.slice(index * FRAME_PAYLOAD_LIMIT, (index + 1) * FRAME_PAYLOAD_LIMIT)
    const frame: Frame = { __frame: true, id, index, total, body }
    channel.send(JSON.stringify(frame))
  }
}

/**
 * Reassembles framed messages. Feed it every raw payload the channel delivers;
 * it returns the decoded message once complete, or null while frames are still
 * outstanding.
 */
export class FrameAssembler {
  private partials = new Map<string, { parts: string[]; filled: number; total: number }>()

  /** Returns the parsed message, or null if this was a frame of an incomplete one. */
  public accept(raw: string): unknown | null {
    const parsed = JSON.parse(raw)
    if (!isFrame(parsed)) return parsed

    let entry = this.partials.get(parsed.id)
    if (!entry) {
      entry = { parts: new Array(parsed.total), filled: 0, total: parsed.total }
      this.partials.set(parsed.id, entry)
    }

    // Count filled slots, not arrivals: a duplicated frame would otherwise push
    // the tally to `total` while a real slot was still empty, and the message
    // would be reassembled with an `undefined` hole in the middle.
    if (entry.parts[parsed.index] === undefined) entry.filled++
    entry.parts[parsed.index] = parsed.body

    if (entry.filled < entry.total) return null

    this.partials.delete(parsed.id)
    return JSON.parse(entry.parts.join(''))
  }

  /** Frames buffered for messages that never completed. */
  public pendingCount(): number {
    return this.partials.size
  }

  public reset(): void {
    this.partials.clear()
  }
}

/**
 * Waits for the channel's queue to fully empty. Call before tearing a
 * connection down: `close()` discards anything still buffered, so a final
 * "we're done" message sent immediately before cleanup never reaches the peer,
 * leaving it waiting on a handshake that already finished.
 */
export async function flushChannel(channel: RTCDataChannel, timeoutMs = 5000): Promise<void> {
  if (channel.readyState !== 'open' || channel.bufferedAmount === 0) return
  const deadline = Date.now() + timeoutMs
  while (channel.bufferedAmount > 0 && Date.now() < deadline) {
    if (channel.readyState !== 'open') return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/**
 * Resolves when ICE gathering finishes, or after `timeoutMs` with whatever was
 * collected.
 *
 * The handshake used to key off a single null-candidate `onicecandidate`. When
 * gathering stalls (STUN unreachable, no network, a strict firewall) that event
 * never arrives, so the SDP was never published and the spinner span forever.
 * Host-only candidates at least let a same-network pairing succeed.
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/**
 * ICE servers for both coordinators. STUN only.
 *
 * STUN cannot help when either side is behind a symmetric NAT (common on mobile
 * tethering and corporate networks). Those need a TURN relay and there is no
 * public one to point at, so a share of internet pairings cannot connect.
 * `onConnectionFailed` makes that visible instead of a hang.
 */
/**
 * Cached, because `new RTCPeerConnection` happens in synchronous code and
 * reading a setting is a round trip through IPC. Refreshed at startup and
 * whenever the user saves the form.
 */
let relay: IceServer | null = null

/** Reads the configured relay into the cache. Safe to call repeatedly. */
export async function refreshTurnServer(): Promise<void> {
  try {
    relay = turnIceServer({
      url: await getStringSetting(TURN_URL_KEY, ''),
      username: await getStringSetting(TURN_USERNAME_KEY, ''),
      credential: await getStringSetting(TURN_CREDENTIAL_KEY, '')
    })
  } catch (err) {
    // A relay that cannot be read is the same as not having one: STUN still
    // works for most pairs, and failing to connect is better than failing to
    // start.
    console.error('[webrtc] Could not read the relay settings:', err)
    relay = null
  }
}

/**
 * What to hand a peer connection. STUN always; a relay only if the user has
 * configured one, since none ships with the app.
 */
export function iceServers(): RTCIceServer[] {
  return (relay ? [...STUN_SERVERS, relay] : [...STUN_SERVERS]) as RTCIceServer[]
}

/**
 * Invokes `handler` when the peer connection reaches a terminal failure state.
 * WebRTC has no built-in "this will never connect" callback, so without this a
 * failed ICE negotiation is indistinguishable from one still in progress.
 */
export function onConnectionFailed(pc: RTCPeerConnection, handler: (reason: string) => void): void {
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') {
      handler(
        'Could not establish a direct connection. This usually means one of the ' +
          'peers is behind a restrictive NAT or firewall that requires a relay.'
      )
    }
  })
  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed') {
      handler('Direct connection failed during ICE negotiation.')
    }
  })
}
