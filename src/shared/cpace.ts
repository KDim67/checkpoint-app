/** CPace, draft-irtf-cfrg-cpace-21, suite CPACE-RISTR255-SHA512: a key from a short code that someone watching can't test guesses against; shared so local sync in main and internet pairing in the screen run the same code */

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'

type Point = ReturnType<typeof ristretto255.Point.fromBytes>

const DSI = utf8ToBytes('CPaceRistretto255')
const DSI_ISK = utf8ToBytes('CPaceRistretto255_ISK')
// SHA-512 reads 128 bytes per block; the padding keeps the code inside the first one
const SHA512_BLOCK_BYTES = 128
const FIELD_BYTES = 32

/** the length as LEB128, then the bytes */
export function prependLen(data: Uint8Array): Uint8Array {
  const length: number[] = []
  let n = data.length
  do {
    length.push(n < 128 ? n : (n & 0x7f) | 0x80)
    n >>>= 7
  } while (n > 0)
  return concatBytes(Uint8Array.from(length), data)
}

export const lvCat = (...parts: Uint8Array[]): Uint8Array => concatBytes(...parts.map(prependLen))

export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Uint8Array {
  const zeros = Math.max(0, SHA512_BLOCK_BYTES - 1 - prependLen(prs).length - prependLen(DSI).length)
  return lvCat(DSI, prs, new Uint8Array(zeros), ci, sid)
}

export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Point {
  // ristretto255 always has one; the shared hasher type also covers curves that don't
  const derive = ristretto255_hasher.deriveToCurve
  if (!derive) throw new Error('This build of @noble/curves has no ristretto255 element derivation.')
  return derive(sha512(generatorString(prs, ci, sid)).subarray(0, 2 * FIELD_BYTES))
}

/** little-endian, as the specification writes scalars */
export const scalarFromBytes = (bytes: Uint8Array): bigint => BigInt(`0x${bytesToHex(Uint8Array.from(bytes).reverse()) || '0'}`)

/** 32 random bytes with every bit from 252 up cleared, so it is always below the group order */
export function sampleScalar(): bigint {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(FIELD_BYTES))
    bytes[FIELD_BYTES - 1] &= 0x0f
    const scalar = scalarFromBytes(bytes)
    // zero has a chance of 2^-252, and multiplying by it would give the identity away
    if (scalar !== 0n) return scalar
  }
}

export const scalarMult = (y: bigint, g: Point): Uint8Array => g.multiply(y).toBytes()

/** null where the specification returns the identity: bytes that don't decode, or a result that is the identity */
export function scalarMultVfy(y: bigint, encoded: Uint8Array): Uint8Array | null {
  let point: Point
  try {
    point = ristretto255.Point.fromBytes(encoded)
  } catch {
    return null
  }
  if (point.is0()) return null
  const product = point.multiply(y)
  return product.is0() ? null : product.toBytes()
}

/** initiator first, as the roles here are fixed */
export const transcriptIr = (ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): Uint8Array =>
  concatBytes(lvCat(ya, ada), lvCat(yb, adb))

export const intermediateKey = (sid: Uint8Array, k: Uint8Array, transcript: Uint8Array): Uint8Array =>
  sha512(concatBytes(lvCat(DSI_ISK, sid, k), transcript))

/** section 10.4: each side proves the key with a tag over the message it sent */
export function confirmationTags(sid: Uint8Array, isk: Uint8Array, ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array): { a: Uint8Array; b: Uint8Array } {
  const macKey = sha512(concatBytes(utf8ToBytes('CPaceMac'), sid, isk))
  return { a: hmac(sha512, macKey, lvCat(ya, ada)), b: hmac(sha512, macKey, lvCat(yb, adb)) }
}
