import { safeStorage } from 'electron'

/** provider keys sat in plaintext in the db and its backups; encrypted via safeStorage (DPAPI/Keychain/libsecret) */

/** ai_providers entries each carry an apiKey, so the whole blob is secret */
// mcp_auth_token grants full read/write, webhook_token creates items; both live in the same file and backups
const SECRET_SETTING_KEYS = new Set([
  'ai_api_key',
  'ai_providers',
  'mcp_auth_token',
  'webhook_token',
  // TURN relay password, someone else's bandwidth billed to the user
  'turn_credential'
])

/** deliberately not JSON: plaintext rows are JSON, so no prefix means a pre-encryption row */
const ENVELOPE_PREFIX = 'enc.v1:'

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key)
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENVELOPE_PREFIX)
}

/** for the one-time plaintext migration */
export function secretSettingKeys(): string[] {
  return [...SECRET_SETTING_KEYS]
}

/** no keyring falls back to plaintext, losing the user's key is worse */
export function encryptSecret(serialized: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[secureSettings] OS encryption unavailable: storing credential as plaintext')
      return serialized
    }
    return ENVELOPE_PREFIX + safeStorage.encryptString(serialized).toString('base64')
  } catch (err) {
    console.error('[secureSettings] Encryption failed, storing plaintext:', err)
    return serialized
  }
}

/** undecryptable yields '' so the user re-enters it rather than sending junk as a token */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64'))
  } catch (err) {
    console.error('[secureSettings] Could not decrypt stored credential:', err)
    return ''
  }
}
