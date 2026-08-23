/**
 * Shared AES-GCM helpers for the WebRTC coordinators.
 * Both the sync and collaboration channels derive a key from the pairing code
 * and wrap their signaling payloads with it.
 */

/**
 * Salts are per-channel so a pairing code leaked from one channel cannot
 * decrypt the other. Changing a salt invalidates every existing pairing code
 * for that channel, which is why they carry a version suffix.
 */
export const SYNC_SALT = 'checkpoint-sync-salt-v2'
export const COLLAB_SALT = 'checkpoint-collab-salt-v2'

/**
 * A 6-digit pairing code is only ~900k possibilities, so the KDF is the only
 * thing making an intercepted signaling blob expensive to crack. 1000 rounds
 * (the previous value) put the whole keyspace within seconds of a laptop;
 * 600k is the current OWASP figure for PBKDF2-SHA256 and costs a few hundred
 * milliseconds once per pairing, which nobody notices.
 */
const PBKDF2_ITERATIONS = 600_000

async function importPasscode(passcode: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  )
}

export async function deriveKey(passcode: string, salt: string): Promise<CryptoKey> {
  const baseKey = await importPasscode(passcode)
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Derives the public signaling topic from the pairing code.
 *
 * ntfy.sh topics are public and unauthenticated: anyone who knows the topic
 * name can read everything posted to it. The previous scheme used the pairing
 * code *as* the topic (`checkpoint-sync-123456`), which published the very
 * secret the payload encryption depended on, the ciphertext and its key
 * material travelled together, so the encryption bought nothing at all, and
 * the entire 6-digit space could simply be subscribed to.
 *
 * Hashing means the topic still identifies the rendezvous point for both
 * peers, but observing it no longer reveals the code, so an eavesdropper is
 * left having to break the KDF above.
 */
export async function deriveTopic(passcode: string, salt: string): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:topic:${passcode}`)
  )
  // 128 bits of the digest is far beyond collision risk for a rendezvous name
  // and keeps the URL short.
  return Array.from(new Uint8Array(digest).subarray(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Converted in blocks rather than one spread call: String.fromCharCode(...bytes)
// passes every byte as a separate argument and blows the stack once a payload
// grows past roughly 64k. SDP with a long ICE candidate list gets close.
function bytesToBase64(bytes: Uint8Array): string {
  const BLOCK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BLOCK))
  }
  return btoa(binary)
}

export async function encryptData(data: string, key: CryptoKey): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    new TextEncoder().encode(data)
  )
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)
  return bytesToBase64(combined)
}

export function base64ToBytes(base64: string): Uint8Array {
  // Indexed fill rather than split('').map(): the latter allocates one string
  // per byte, which is ruinous for the multi-megabyte payloads file transfer
  // pushes through here.
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export { bytesToBase64 }

export async function decryptData(base64Data: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(base64Data)
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}
