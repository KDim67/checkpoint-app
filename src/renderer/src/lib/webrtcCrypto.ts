/** base64 for file bytes over the data channel; pairing and its keys are in shared/internetPairing */

// in blocks, spreading every byte blows the stack past ~64k
export function bytesToBase64(bytes: Uint8Array): string {
  const BLOCK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BLOCK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  // indexed fill, split('').map() allocates a string per byte
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
