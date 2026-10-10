/** local-network sync's wire: CPace turns the pairing code into a key, both sides prove they hold it, then every line is AES-256-GCM */

import type { Socket } from 'node:net'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  calculateGenerator,
  confirmationTags,
  intermediateKey,
  lvCat,
  sampleScalar,
  scalarMult,
  scalarMultVfy,
  transcriptIr
} from '../../shared/cpace'

export const SYNC_PROTOCOL_VERSION = 2
const HELLO = 'checkpoint-sync'
// the roles are part of the key, so a connecting computer can only ever be paired with a host
const CI = lvCat(Buffer.from('checkpoint local sync'), Buffer.from('initiator: client'), Buffer.from('responder: host'))
const NO_AD = Buffer.alloc(0)
const SID_BYTES = 16
const POINT_BYTES = 32
const TAG_BYTES = 64
const GCM_TAG_BYTES = 16
// a handshake line is a few dozen characters; anything longer before a key is agreed is refused
const HANDSHAKE_LINE_MAX = 512
// a whole database travels as one line; past this it is refused rather than held in memory
const FRAME_LINE_MAX = 256 * 1024 * 1024
export const HANDSHAKE_TIMEOUT_MS = 30_000

export type HandshakeFailure = 'wrong-code' | 'older-peer' | 'other-version' | 'unverified' | 'bad-message' | 'closed' | 'timeout'

export class HandshakeError extends Error {
  constructor(readonly reason: HandshakeFailure, message: string) {
    super(message)
    this.name = 'HandshakeError'
  }
}

export interface SecureChannel {
  send(line: string): void
  /** lines arrive in order, each one authenticated; any that came before a handler was set are kept for it */
  onLine(handler: (line: string) => void): void
  /** a frame that fails to authenticate ends the channel with an error; the socket closing ends it with none */
  onClose(handler: (error: Error | null) => void): void
  /** after what was sent has gone */
  end(): void
}

/** one key per direction and a counter for the nonce, so no nonce is ever used twice and a replayed or reordered frame fails */
class Direction {
  private counter = 0n
  constructor(private readonly key: Buffer) {}

  private nonce(): Buffer {
    // 2^32 frames is a lifetime of syncs; past it the key is retired rather than risk a repeat
    if (this.counter >= 0xffffffffn) throw new Error('This sync went on too long to stay encrypted safely.')
    const nonce = Buffer.alloc(12)
    nonce.writeBigUInt64BE(this.counter++, 4)
    return nonce
  }

  seal(plaintext: Buffer): string {
    const cipher = createCipheriv('aes-256-gcm', this.key, this.nonce())
    return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64')
  }

  open(frame: string): Buffer {
    const raw = Buffer.from(frame, 'base64')
    if (raw.length < GCM_TAG_BYTES) throw new Error('A sync message was cut short.')
    const decipher = createDecipheriv('aes-256-gcm', this.key, this.nonce())
    decipher.setAuthTag(raw.subarray(raw.length - GCM_TAG_BYTES))
    return Buffer.concat([decipher.update(raw.subarray(0, raw.length - GCM_TAG_BYTES)), decipher.final()])
  }
}

const trafficKey = (isk: Uint8Array, sid: Uint8Array, direction: string): Buffer =>
  Buffer.from(hkdfSync('sha256', isk, sid, `checkpoint local sync v${SYNC_PROTOCOL_VERSION} ${direction}`, 32))

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/** strict, so a stray character can't be read as different bytes */
function fromB64(text: string | undefined, length: number): Buffer | null {
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const bytes = Buffer.from(text, 'base64')
  return bytes.length === length && bytes.toString('base64') === text ? bytes : null
}

const sameTag = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.length === b.length && timingSafeEqual(a, b)

type Role = 'host' | 'client'

function handshake(socket: Socket, code: string, role: Role, timeoutMs: number): Promise<SecureChannel> {
  return new Promise((resolve, reject) => {
    const prs = Buffer.from(code, 'utf8')
    let buffer = ''
    let limit = HANDSHAKE_LINE_MAX
    let settled = false
    let receive: (line: string) => void = () => {}
    const write = (line: string): void => { socket.write(`${line}\n`) }

    const fail = (reason: HandshakeFailure, message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      receive = () => {}
      // a refused code is said before closing, so the other side hears why
      if (reason === 'wrong-code') socket.end()
      else socket.destroy()
      reject(new HandshakeError(reason, message))
    }
    const timer = setTimeout(() => fail('timeout', 'The other computer stopped answering before the connection was secured.'), timeoutMs)

    socket.on('data', (chunk: Buffer) => {
      // everything on the wire is ASCII; latin1 keeps one character per byte, so a chunk boundary can't break one
      buffer += chunk.toString('latin1')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line) receive(line)
        if (socket.destroyed) return
        newline = buffer.indexOf('\n')
      }
      if (buffer.length > limit) {
        if (settled) socket.destroy(new Error('A sync message was larger than Checkpoint accepts.'))
        else fail('bad-message', 'The other computer sent something too long to be part of pairing.')
      }
    })
    socket.on('error', err => fail('closed', err.message))
    socket.on('close', () => fail('closed', 'The connection closed before the computers paired.'))

    const establish = (isk: Uint8Array, sid: Uint8Array): void => {
      settled = true
      clearTimeout(timer)
      limit = FRAME_LINE_MAX
      const outgoing = new Direction(trafficKey(isk, sid, role === 'client' ? 'client to host' : 'host to client'))
      const incoming = new Direction(trafficKey(isk, sid, role === 'client' ? 'host to client' : 'client to host'))
      const queued: string[] = []
      let deliver: ((line: string) => void) | null = null
      const closers: ((error: Error | null) => void)[] = []
      let closedWith: Error | null | undefined
      const closed = (error: Error | null): void => {
        if (closedWith !== undefined) return
        closedWith = error
        for (const handler of closers) handler(error)
      }
      socket.on('error', err => closed(err))
      socket.on('close', () => closed(null))
      receive = frame => {
        let line: string
        try {
          line = incoming.open(frame).toString('utf8')
        } catch {
          // forged, replayed, reordered or corrupted: nothing after it can be trusted
          const error = new Error('A sync message failed its integrity check, so the sync stopped.')
          closed(error)
          socket.destroy()
          return
        }
        if (deliver) deliver(line)
        else queued.push(line)
      }
      resolve({
        send: line => { if (!socket.destroyed) write(outgoing.seal(Buffer.from(line, 'utf8'))) },
        onLine: handler => {
          deliver = handler
          for (const line of queued.splice(0)) handler(line)
        },
        onClose: handler => {
          if (closedWith !== undefined) handler(closedWith)
          else closers.push(handler)
        },
        end: () => socket.end()
      })
    }

    if (role === 'host') {
      const sidB = randomBytes(SID_BYTES)
      let step: 'a' | 'confirm' = 'a'
      let expect: { a: Uint8Array; b: Uint8Array } | null = null
      let session: { isk: Uint8Array; sid: Uint8Array } | null = null
      write(`${HELLO} ${SYNC_PROTOCOL_VERSION} ${b64(sidB)}`)
      receive = line => {
        const [kind, first, second] = line.split(' ')
        if (step === 'a' && kind === 'cpace-a') {
          const sidA = fromB64(first, SID_BYTES)
          const ya = fromB64(second, POINT_BYTES)
          if (!sidA || !ya) return fail('bad-message', 'The other computer sent a pairing message Checkpoint could not read.')
          const sid = Buffer.concat([sidB, sidA])
          const yb = sampleScalar()
          const Yb = scalarMult(yb, calculateGenerator(prs, CI, sid))
          const k = scalarMultVfy(yb, ya)
          if (!k) return fail('bad-message', 'The other computer sent a pairing value that is not allowed.')
          const isk = intermediateKey(sid, k, transcriptIr(ya, NO_AD, Yb, NO_AD))
          expect = confirmationTags(sid, isk, ya, NO_AD, Yb, NO_AD)
          session = { isk, sid }
          step = 'confirm'
          write(`cpace-b ${b64(Yb)}`)
        } else if (step === 'confirm' && kind === 'confirm' && expect && session) {
          if (!sameTag(fromB64(first, TAG_BYTES), expect.a)) {
            write('auth-failed')
            return fail('wrong-code', 'The pairing code did not match.')
          }
          write(`confirm ${b64(expect.b)}`)
          establish(session.isk, session.sid)
        } else {
          fail('bad-message', 'The other computer did not follow the pairing steps.')
        }
      }
    } else {
      let step: 'hello' | 'b' | 'confirm' = 'hello'
      let ya = 0n
      let Ya: Uint8Array | null = null
      let sid: Buffer | null = null
      let expect: { a: Uint8Array; b: Uint8Array } | null = null
      let isk: Uint8Array | null = null
      receive = line => {
        const [kind, first, second] = line.split(' ')
        if (step === 'hello') {
          if (line.startsWith('auth-challenge:')) {
            return fail('older-peer', 'The other computer runs an older Checkpoint, which syncs without encryption. Update it to sync.')
          }
          if (kind !== HELLO) return fail('bad-message', 'That address is not a Checkpoint sync host.')
          if (first !== String(SYNC_PROTOCOL_VERSION)) {
            return fail('other-version', 'The other computer runs a different version of Checkpoint. Update both to sync.')
          }
          const sidB = fromB64(second, SID_BYTES)
          if (!sidB) return fail('bad-message', 'The other computer sent a pairing message Checkpoint could not read.')
          const sidA = randomBytes(SID_BYTES)
          sid = Buffer.concat([sidB, sidA])
          ya = sampleScalar()
          Ya = scalarMult(ya, calculateGenerator(prs, CI, sid))
          step = 'b'
          write(`cpace-a ${b64(sidA)} ${b64(Ya)}`)
        } else if (step === 'b' && kind === 'cpace-b' && Ya && sid) {
          const Yb = fromB64(first, POINT_BYTES)
          const k = Yb ? scalarMultVfy(ya, Yb) : null
          if (!Yb || !k) return fail('bad-message', 'The other computer sent a pairing value that is not allowed.')
          isk = intermediateKey(sid, k, transcriptIr(Ya, NO_AD, Yb, NO_AD))
          expect = confirmationTags(sid, isk, Ya, NO_AD, Yb, NO_AD)
          step = 'confirm'
          write(`confirm ${b64(expect.a)}`)
        } else if (step === 'confirm' && line === 'auth-failed') {
          fail('wrong-code', 'The pairing code did not match.')
        } else if (step === 'confirm' && kind === 'confirm' && expect && isk && sid) {
          // a host without the code can't make this tag, so nothing is sent to one
          if (!sameTag(fromB64(first, TAG_BYTES), expect.b)) {
            return fail('unverified', "Couldn't confirm the other computer has the pairing code, so nothing was sent.")
          }
          establish(isk, sid)
        } else {
          fail('bad-message', 'The other computer did not follow the pairing steps.')
        }
      }
    }
  })
}

/** the host's side; it speaks first */
export const acceptSecure = (socket: Socket, code: string, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<SecureChannel> =>
  handshake(socket, code, 'host', timeoutMs)

/** the connecting computer's side */
export const connectSecure = (socket: Socket, code: string, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<SecureChannel> =>
  handshake(socket, code, 'client', timeoutMs)
