/** meeting over the internet, for sync and board sharing alike: CPace through a public ntfy.sh room, then the connection details sealed with its keys */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { readSignalingMessage, signalingPublishError } from '../../../shared/signalingPayload'
import { signalingPublishUrl, signalingStreamUrl } from '../../../shared/signalingHost'
import {
  answerGuestPairing,
  MAX_PAIRING_FAILURES,
  openPairing,
  roomTopic,
  sealPairing,
  startGuestPairing,
  type InternetCode,
  type PairingKeys,
  type PairingPurpose
} from '../../../shared/internetPairing'

// posts are uncached and reach only those already listening, so nothing is posted before the stream is open
const OPEN_WAIT_MS = 5000
/** how long a guest waits for an answer before saying nobody is there */
export const GUEST_WAIT_MS = 60_000
// a guest who said hello and never sent an offer still holds keys; past this many the oldest go
const PENDING_GUESTS_MAX = 32

type Kind = 'hello' | 'reply' | 'offer' | 'answer' | 'refused'

/** which offer a refusal is about, so one provoked by a forged offer can't turn the real guest away */
const offerDigest = (offer: string): string => bytesToHex(sha256(utf8ToBytes(offer))).slice(0, 32)

/** one room: messages are titled kind:guest, so guests sharing it never act on each other's */
class Room {
  private readonly sse: EventSource
  readonly opened: Promise<void>

  constructor(private readonly topic: string, onMessage: (kind: string, guest: string, body: string) => void) {
    this.sse = new EventSource(signalingStreamUrl(topic))
    this.opened = new Promise(resolve => {
      const timer = setTimeout(resolve, OPEN_WAIT_MS)
      this.sse.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    this.sse.onmessage = event => {
      const signal = readSignalingMessage(event.data)
      const at = signal ? signal.title.indexOf(':') : -1
      if (!signal || at <= 0) return
      onMessage(signal.title.slice(0, at), signal.title.slice(at + 1), signal.body)
    }
  }

  async post(kind: Kind, guest: string, body: string): Promise<void> {
    const res = await fetch(signalingPublishUrl(this.topic), { method: 'POST', headers: { Title: `${kind}:${guest}` }, body })
    const failure = signalingPublishError(res.status)
    if (failure) throw new Error(failure)
  }

  close(): void {
    this.sse.close()
  }
}

export interface HostPairingOptions {
  code: InternetCode
  purpose: PairingPurpose
  /** an offer that opened, so its guest has the secret; answer it with this side's connection details */
  onOffer: (guest: string, details: string, answer: (details: string) => Promise<void>) => void
  /** a wrong code or a guess; spent once there have been too many, and then nobody else can join */
  onRefused: (failures: number, spent: boolean) => void
  onError: (err: unknown) => void
}

/** the side that shows the code and waits */
export class HostPairing {
  private room: Room | null = null
  private readonly pending = new Map<string, PairingKeys>()
  private failures = 0

  constructor(private readonly options: HostPairingOptions) {}

  async start(): Promise<void> {
    const room = new Room(roomTopic(this.options.purpose, this.options.code.room), (kind, guest, body) => {
      this.receive(room, kind, guest, body).catch(err => this.options.onError(err))
    })
    this.room = room
    await room.opened
  }

  private async receive(room: Room, kind: string, guest: string, body: string): Promise<void> {
    if (this.room !== room) return
    if (kind === 'hello') {
      // a repeat is the same guest retrying, or someone replaying it
      if (this.pending.has(guest)) return
      const answered = await answerGuestPairing(this.options.code, this.options.purpose, body)
      if (!answered || this.room !== room) return
      if (this.pending.size >= PENDING_GUESTS_MAX) this.pending.delete(this.pending.keys().next().value as string)
      this.pending.set(guest, answered.keys)
      await room.post('reply', guest, answered.reply)
    } else if (kind === 'offer') {
      const keys = this.pending.get(guest)
      if (!keys) return
      const details = await openPairing(keys.receive, body)
      if (this.room !== room) return
      if (details === null) {
        // kept, so a forged offer can't knock out the real guest's; each one still counts
        this.failures++
        const spent = this.failures >= MAX_PAIRING_FAILURES
        await room.post('refused', guest, offerDigest(body)).catch(() => {})
        if (spent) this.close()
        this.options.onRefused(this.failures, spent)
        return
      }
      this.pending.delete(guest)
      this.options.onOffer(guest, details, async answer => {
        await room.post('answer', guest, await sealPairing(keys.send, answer))
      })
    }
  }

  close(): void {
    this.room?.close()
    this.room = null
    this.pending.clear()
  }
}

export interface GuestPairingOptions {
  code: InternetCode
  purpose: PairingPurpose
  guest: string
  /** this side's connection details, once gathered; sent only sealed */
  offer: Promise<string>
  /** the host's details, opened, so the host has the secret */
  onAnswer: (details: string) => void
  onError: (err: unknown) => void
}

/** the side that types the code in */
export class GuestPairingRoom {
  private room: Room | null = null
  private keys: Promise<PairingKeys | null> | null = null
  private sentOffer: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private done = false

  constructor(private readonly options: GuestPairingOptions) {}

  async start(): Promise<void> {
    const { code, purpose, guest } = this.options
    const pairing = startGuestPairing(code, purpose)
    const room = new Room(roomTopic(purpose, code.room), (kind, to, body) => {
      if (to !== guest) return
      this.receive(room, kind, body, pairing.finish).catch(err => this.fail(err))
    })
    this.room = room
    this.timer = setTimeout(() => {
      this.fail(new Error('Nobody answered in that room. Check the code, and that the other computer is still waiting.'))
    }, GUEST_WAIT_MS)
    await room.opened
    if (!this.done) await room.post('hello', guest, pairing.hello)
  }

  private async receive(room: Room, kind: string, body: string, finish: (reply: string) => Promise<PairingKeys | null>): Promise<void> {
    if (this.done || this.room !== room) return
    if (kind === 'reply' && !this.keys) {
      // the first reply is the host's; a second is a stranger in the same room, or a replay
      this.keys = finish(body)
      const keys = await this.keys
      if (!keys) throw new Error("The other computer's reply couldn't be read.")
      const details = await this.options.offer
      if (this.done) return
      this.sentOffer = await sealPairing(keys.send, details)
      await room.post('offer', this.options.guest, this.sentOffer)
    } else if (kind === 'answer' && this.keys) {
      const keys = await this.keys
      if (!keys) return
      const details = await openPairing(keys.receive, body)
      if (details === null) throw new Error("Couldn't confirm the other computer has the code, so nothing more was sent.")
      this.finish()
      this.options.onAnswer(details)
    } else if (kind === 'refused' && this.sentOffer && body === offerDigest(this.sentOffer)) {
      throw new Error("The code didn't match. Check it with the other computer and try again.")
    }
  }

  private finish(): void {
    this.done = true
    if (this.timer) clearTimeout(this.timer)
    this.room?.close()
    this.room = null
  }

  private fail(err: unknown): void {
    if (this.done) return
    this.finish()
    this.options.onError(err)
  }

  close(): void {
    this.finish()
  }
}
