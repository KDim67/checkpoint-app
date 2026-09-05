import { safeStorage } from 'electron'

/**
 * At-rest encryption for settings that hold credentials.
 *
 * Cloud provider keys (OpenAI, Groq, OpenRouter, Gemini…) used to sit in the
 * settings table as plaintext, which meant anything able to read checkpoint.db
 * (including the rolling gzip backups the vault writes) could lift a live
 * billable credential. These two keys are encrypted with the OS keychain
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux) via safeStorage.
 */

/**
 * `ai_api_key` is the active provider's key. `ai_providers` is the full profile
 * list, and every entry in it carries its own `apiKey` field, so the whole blob
 * is a secret even though only part of it is credential material.
 */
// `mcp_auth_token` grants full read/write over every workspace to whoever holds
// it, so it is encrypted at rest alongside the provider keys rather than
// sitting in plaintext next to them. `webhook_token` is the same bargain in a
// smaller form: it lets its holder create items over HTTP, and it sits in the
// same file and the same backups.
const SECRET_SETTING_KEYS = new Set([
  'ai_api_key',
  'ai_providers',
  'mcp_auth_token',
  'webhook_token',
  // A TURN relay's password. Someone else's bandwidth, billed to the user.
  'turn_credential'
])

/**
 * Marks an encrypted payload. Deliberately not valid JSON: every plaintext
 * value in this table is JSON, so a value lacking this prefix is unambiguously
 * a pre-encryption row and is passed through untouched. That makes existing
 * installs keep working and lets migration be a re-write rather than a parse.
 */
const ENVELOPE_PREFIX = 'enc.v1:'

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key)
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENVELOPE_PREFIX)
}

/** Every secret key, for the one-time migration of existing plaintext rows. */
export function secretSettingKeys(): string[] {
  return [...SECRET_SETTING_KEYS]
}

/**
 * Encrypts a serialized setting value. If the OS has no usable keyring we store
 * plaintext rather than refusing the write. Losing the user's configured key
 * is a worse outcome than storing it the way it was already being stored.
 */
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

/**
 * Reverses encryptSecret. A value that was never encrypted is returned as-is.
 * A value that is enveloped but undecryptable (keyring reset, restored to a
 * different machine or user profile) yields '' so the caller falls back to its
 * default and the user is asked to re-enter the key, rather than the app
 * handing a corrupt string to a provider as a bearer token.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64'))
  } catch (err) {
    console.error('[secureSettings] Could not decrypt stored credential:', err)
    return ''
  }
}
