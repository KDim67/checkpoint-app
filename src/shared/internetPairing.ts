/** internet pairing: a public room on ntfy.sh to meet in, and a secret that only ever enters CPace, so nobody watching the room can learn it or step in between */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { calculateGenerator, intermediateKey, lvCat, sampleScalar, scalarMult, scalarMultVfy, transcriptIr } from './cpace'

export type PairingPurpose = 'sync' | 'collab'

// no 0 or O, no 1, I or L: read aloud or off a screen, none can be taken for another
export const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const ROOM_LENGTH = 4
const SID_BYTES = 16
const POINT_BYTES = 32
const IV_BYTES = 12
export const PAIRING_VERSION = 3
/** one guess per try; after this many the host stops taking new ones and the code is spent */
export const MAX_PAIRING_FAILURES = 5
export const CODE_EXAMPLE = 'K7QD-482913'
export const BAD_CODE_MESSAGE = `That code doesn't look right. It looks like ${CODE_EXAMPLE}.`

/** uniform below max by rejection, so no character or digit comes up more often than another */
function uniform(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  for (;;) {
    const [n] = globalThis.crypto.getRandomValues(new Uint32Array(1))
    if (n < limit) return n % max
  }
}

export interface InternetCode {
  /** anyone watching ntfy.sh may see this part */
  room: string
  /** this part never leaves either computer */
  secret: string
}

export function newInternetCode(): string {
  const room = Array.from({ length: ROOM_LENGTH }, () => ROOM_ALPHABET[uniform(ROOM_ALPHABET.length)]).join('')
  return `${room}-${100000 + uniform(900000)}`
}

/** case, spaces and the dash don't matter; null for anything that isn't a code */
export function parseInternetCode(text: string): InternetCode | null {
  const compact = text.toUpperCase().replace(/[\s-]+/g, '')
  const room = compact.slice(0, ROOM_LENGTH)
  const secret = compact.slice(ROOM_LENGTH)
  if (room.length !== ROOM_LENGTH || [...room].some(c => !ROOM_ALPHABET.includes(c))) return null
  return /^\d{6}$/.test(secret) ? { room, secret } : null
}

/** from the room alone, so seeing it says nothing about the secret */
export function roomTopic(purpose: PairingPurpose, room: string): string {
  const digest = bytesToHex(sha256(utf8ToBytes(`checkpoint ${purpose} room v${PAIRING_VERSION}:${room}`)))
  return `checkpoint-${purpose}-v${PAIRING_VERSION}-${digest.slice(0, 32)}`
}

/** addressed to one guest, so guests sharing a room never act on each other's messages */
export const newGuestId = (): string => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(8)))

// the room and the roles are part of the key, so a session can't be carried into another room or turned around
const channelId = (purpose: PairingPurpose, room: string): Uint8Array => lvCat(
  utf8ToBytes(`checkpoint internet pairing v${PAIRING_VERSION}`),
  utf8ToBytes(purpose),
  utf8ToBytes(room),
  utf8ToBytes('initiator: guest'),
  utf8ToBytes('responder: host')
)
const NO_AD = new Uint8Array(0)

export interface PairingKeys {
  send: CryptoKey
  receive: CryptoKey
}

async function keysFor(isk: Uint8Array, sid: Uint8Array, role: 'guest' | 'host'): Promise<PairingKeys> {
  const subtle = globalThis.crypto.subtle
  const base = await subtle.importKey('raw', Uint8Array.from(isk), 'HKDF', false, ['deriveKey'])
  const derive = (direction: string): Promise<CryptoKey> => subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: Uint8Array.from(sid), info: utf8ToBytes(`checkpoint internet pairing v${PAIRING_VERSION} ${direction}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const [toHost, toGuest] = await Promise.all([derive('guest to host'), derive('host to guest')])
  return role === 'guest' ? { send: toHost, receive: toGuest } : { send: toGuest, receive: toHost }
}

function toB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromB64(text: string, length?: number): Uint8Array<ArrayBuffer> | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  if (length !== undefined && binary.length !== length) return null
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

export interface GuestPairing {
  /** posted first, as the guest's hello */
  hello: string
  /** the host's reply turns into the keys; null for a reply that can't be one */
  finish(reply: string): Promise<PairingKeys | null>
}

export function startGuestPairing(code: InternetCode, purpose: PairingPurpose): GuestPairing {
  const sid = globalThis.crypto.getRandomValues(new Uint8Array(SID_BYTES))
  const ya = sampleScalar()
  const Ya = scalarMult(ya, calculateGenerator(utf8ToBytes(code.secret), channelId(purpose, code.room), sid))
  return {
    hello: toB64(concatBytes(sid, Ya)),
    finish: async reply => {
      const Yb = fromB64(reply, POINT_BYTES)
      const k = Yb ? scalarMultVfy(ya, Yb) : null
      if (!Yb || !k) return null
      return keysFor(intermediateKey(sid, k, transcriptIr(Ya, NO_AD, Yb, NO_AD)), sid, 'guest')
    }
  }
}

/** the host's answer to one guest's hello; null for a hello that can't be one */
export async function answerGuestPairing(code: InternetCode, purpose: PairingPurpose, hello: string): Promise<{ reply: string; keys: PairingKeys } | null> {
  const bytes = fromB64(hello, SID_BYTES + POINT_BYTES)
  if (!bytes) return null
  const sid = bytes.subarray(0, SID_BYTES)
  const Ya = bytes.subarray(SID_BYTES)
  const yb = sampleScalar()
  const Yb = scalarMult(yb, calculateGenerator(utf8ToBytes(code.secret), channelId(purpose, code.room), sid))
  const k = scalarMultVfy(yb, Ya)
  if (!k) return null
  return { reply: toB64(Yb), keys: await keysFor(intermediateKey(sid, k, transcriptIr(Ya, NO_AD, Yb, NO_AD)), sid, 'host') }
}

/** AES-GCM under a fresh nonce */
export async function sealPairing(key: CryptoKey, text: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  return toB64(concatBytes(iv, sealed))
}

/** opening is the proof: only the side holding the same key, so the same secret, could have sealed it */
export async function openPairing(key: CryptoKey, sealed: string): Promise<string | null> {
  const bytes = fromB64(sealed)
  if (!bytes || bytes.length <= IV_BYTES) return null
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) }, key, bytes.subarray(IV_BYTES))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
