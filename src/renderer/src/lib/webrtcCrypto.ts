/** AES-GCM keyed from the pairing code, shared by sync and collaboration signalling */

/** per-channel salts so a leaked code can't decrypt the other; versioned since changing one breaks codes */
export const SYNC_SALT = 'checkpoint-sync-salt-v2'
export const COLLAB_SALT = 'checkpoint-collab-salt-v2'

/** 6 digits is ~900k codes, the KDF is the only cost; 600k rounds per OWASP, a few hundred ms per pairing */
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

/** ntfy topics are public; the old scheme published the code itself, so hash it */
export async function deriveTopic(passcode: string, salt: string): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:topic:${passcode}`)
  )
  // 128 bits is plenty for a rendezvous name and keeps the URL short
  return Array.from(new Uint8Array(digest).subarray(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// in blocks, spreading every byte blows the stack past ~64k
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
  // indexed fill, split('').map() allocates a string per byte
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
