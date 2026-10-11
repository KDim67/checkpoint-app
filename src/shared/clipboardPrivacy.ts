/** the copying program's own mark decides first, unmarked copies get a guess; skipping a recopyable string beats storing a credential */

import { PRIVATE_KEY, TOKEN_SHAPES } from './redactSecrets'

/** what the marks are read through, so they can be checked without electron */
export interface ClipboardMarks {
  has(format: string): boolean
  read(format: string): Uint8Array
}

// the published conventions: windows' clipboard history formats, nspasteboard.org on macos, klipper's hint on linux
const PRIVATE_WHEN_PRESENT: Partial<Record<string, string[]>> = {
  win32: ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore'],
  darwin: ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType']
}
/** a DWORD of 0 keeps it out; the cloud one counts too, as this history travels to your other computers */
const PRIVATE_WHEN_ZERO: Partial<Record<string, string[]>> = {
  win32: ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']
}
const PRIVATE_WHEN_SECRET: Partial<Record<string, string[]>> = {
  linux: ['x-kde-passwordManagerHint']
}

/** only a well-formed non-zero DWORD lets it through */
function allowedByDword(bytes: Uint8Array): boolean {
  return bytes.length === 4 && bytes.some(b => b !== 0)
}

/** the program that copied it asked clipboard histories to leave it out; a mark that can't be read counts as private */
export function markedPrivate(clip: ClipboardMarks, platform: string): boolean {
  try {
    if ((PRIVATE_WHEN_PRESENT[platform] ?? []).some(format => clip.has(format))) return true
    if ((PRIVATE_WHEN_ZERO[platform] ?? []).some(format => clip.has(format) && !allowedByDword(clip.read(format)))) return true
    return (PRIVATE_WHEN_SECRET[platform] ?? []).some(
      format => clip.has(format) && new TextDecoder().decode(clip.read(format)).trim() === 'secret'
    )
  } catch {
    return true
  }
}

/** unambiguous shapes, matched first: a private key anywhere in the copy, a token as the whole of it */
const KNOWN_SECRET_PATTERNS: RegExp[] = [PRIVATE_KEY, ...TOKEN_SHAPES.map(shape => new RegExp(`^(?:${shape.source})$`))]

/** too short and too word-like below this */
const MIN_LENGTH = 8
/** prose above this */
const MAX_LENGTH = 200
/** of lower, upper, digit, symbol */
const REQUIRED_CLASSES = 3

function characterClasses(text: string): number {
  let classes = 0
  if (/[a-z]/.test(text)) classes++
  if (/[A-Z]/.test(text)) classes++
  if (/[0-9]/.test(text)) classes++
  if (/[^A-Za-z0-9]/.test(text)) classes++
  return classes
}

/** one unbroken run, credential length, three classes; paths and URLs excluded first */
export function looksLikeSecret(raw: string): boolean {
  const text = raw.trim()
  if (!text) return false

  if (KNOWN_SECRET_PATTERNS.some(pattern => pattern.test(text))) return true

  // spaces mean a sentence, command or passphrase, can't judge
  if (/\s/.test(text)) return false
  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) return false

  // URLs and paths, copied constantly
  if (text.includes('://') || text.includes('/') || text.includes('\\')) return false
  // emails, likewise
  if (/^[^@]+@[^@]+\.[^@]+$/.test(text)) return false

  return characterClasses(text) >= REQUIRED_CLASSES
}
