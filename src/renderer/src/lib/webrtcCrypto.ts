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
export const SYNC_SALT = 'checkpoint-sync-salt-v1'
export const COLLAB_SALT = 'checkpoint-collab-salt-v1'

export async function deriveKey(passcode: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 1000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
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

export async function decryptData(base64Data: string, key: CryptoKey): Promise<string> {
  const combined = new Uint8Array(
    atob(base64Data).split('').map(c => c.charCodeAt(0))
  )
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}
