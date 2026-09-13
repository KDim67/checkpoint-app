/** SCTP caps a message at 256 KB and the send queue at 16 MB, both hit; use sendFramed and FrameAssembler */

import { errorMessage } from '../../../shared/errors'
import { STUN_SERVERS, turnIceServer, type IceServer } from '../../../shared/iceConfig'
import { getStringSetting } from './settings'

/** never synced, encrypted at rest */
export const TURN_URL_KEY = 'turn_url'
export const TURN_USERNAME_KEY = 'turn_username'
export const TURN_CREDENTIAL_KEY = 'turn_credential'

/** well under 256 KB, room for the envelope, path and base64 */
const FRAME_PAYLOAD_LIMIT = 48 * 1024

/** pause here, resume when drained; far under chromium's 16 MB for latency and headroom */
const BUFFER_HIGH_WATER = 1024 * 1024
const BUFFER_LOW_WATER = 256 * 1024

/** give up on a congested channel after this */
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

/** rejects on close or timeout, so a stalled peer errors instead of hanging */
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

/** errorDetail is the whole diagnosis; read defensively, this mustn't throw while explaining a throw */
export function describeChannelError(event: Event): string {
  const error = (event as { error?: unknown }).error
  if (!error || typeof error !== 'object') return errorMessage(event, 'The data channel failed.')

  const detail = (error as { errorDetail?: unknown }).errorDetail
  const message = (error as { message?: unknown }).message
  const cause = (error as { sctpCauseCode?: unknown }).sctpCauseCode

  const parts: string[] = []
  if (typeof detail === 'string' && detail) parts.push(detail)
  if (typeof cause === 'number') parts.push(`SCTP cause ${cause}`)
  const head = parts.join(', ')
  const tail = typeof message === 'string' && message.trim() ? message.trim() : ''

  if (head && tail) return `${head}: ${tail}`
  return head || tail || 'The data channel failed.'
}

/** wait for the goodbye to go */
const FAREWELL_TIMEOUT_MS = 600

/** close the channel, not the connection, so SCTP delivers what's queued; bounded since a gone peer never drains */
export function closeGracefully(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== 'open') return Promise.resolve()

  return new Promise(resolve => {
    const deadline = Date.now() + FAREWELL_TIMEOUT_MS

    const shut = (): void => {
      channel.removeEventListener('close', done)
      resolve()
    }
    const done = (): void => shut()

    const drain = (): void => {
      if (channel.readyState !== 'open') return shut()
      if (channel.bufferedAmount === 0 || Date.now() >= deadline) {
        channel.addEventListener('close', done, { once: true })
        channel.close()
        // the close event confirms, this is the deadline
        setTimeout(shut, Math.max(0, deadline - Date.now()))
        return
      }
      setTimeout(drain, 20)
    }

    drain()
  })
}

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
  // random, both peers frame concurrently and counters would collide
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

/** feed it every raw payload, returns the message once complete */
export class FrameAssembler {
  private partials = new Map<string, { parts: string[]; filled: number; total: number }>()

  /** null while frames are outstanding */
  public accept(raw: string): unknown | null {
    const parsed = JSON.parse(raw)
    if (!isFrame(parsed)) return parsed

    let entry = this.partials.get(parsed.id)
    if (!entry) {
      entry = { parts: new Array(parsed.total), filled: 0, total: parsed.total }
      this.partials.set(parsed.id, entry)
    }

    // count filled slots, a duplicate frame would leave an undefined hole
    if (entry.parts[parsed.index] === undefined) entry.filled++
    entry.parts[parsed.index] = parsed.body

    if (entry.filled < entry.total) return null

    this.partials.delete(parsed.id)
    return JSON.parse(entry.parts.join(''))
  }

  /** frames for messages that never completed */
  public pendingCount(): number {
    return this.partials.size
  }

  public reset(): void {
    this.partials.clear()
  }
}

/** close() drops what's buffered, so a final message sent right before cleanup never arrives */
export async function flushChannel(channel: RTCDataChannel, timeoutMs = 5000): Promise<void> {
  if (channel.readyState !== 'open' || channel.bufferedAmount === 0) return
  const deadline = Date.now() + timeoutMs
  while (channel.bufferedAmount > 0 && Date.now() < deadline) {
    if (channel.readyState !== 'open') return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** bounded: the null-candidate event may never come, host candidates still pair on a LAN */
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

/** STUN only by default; symmetric NATs need a TURN relay, onConnectionFailed makes that visible */
/** cached, new RTCPeerConnection is synchronous and settings are IPC */
let relay: IceServer | null = null

/** safe to call repeatedly */
export async function refreshTurnServer(): Promise<void> {
  try {
    relay = turnIceServer({
      url: await getStringSetting(TURN_URL_KEY, ''),
      username: await getStringSetting(TURN_USERNAME_KEY, ''),
      credential: await getStringSetting(TURN_CREDENTIAL_KEY, '')
    })
  } catch (err) {
    // an unreadable relay is no relay, STUN still works for most
    console.error('[webrtc] Could not read the relay settings:', err)
    relay = null
  }
}

/** STUN always, a relay only if configured */
export function iceServers(): RTCIceServer[] {
  return (relay ? [...STUN_SERVERS, relay] : [...STUN_SERVERS]) as RTCIceServer[]
}

/** WebRTC has no "never connecting" callback */
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
