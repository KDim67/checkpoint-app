/**
 * Reads a plugin's name and version without running it. The registry used to
 * `require()` every file just to list them, including disabled ones, which
 * made the off switch meaningless.
 *
 * Parses the source as text, best-effort: the values are only displayed, so an
 * unreadable one is shown by filename rather than executed to find out.
 */

interface PluginMetadata {
  name: string | null
  description: string | null
  version: string | null
}

/** Pulls a single string field out of a metadata block. */
function field(block: string, key: string): string | null {
  // Both quote styles, and an optionally quoted key, since this is hand-written
  // JavaScript rather than JSON.
  const match = new RegExp(`["']?${key}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(block)
  if (!match) return null
  // Unescape the few sequences that actually appear in a quoted literal.
  const value = match[2].replace(/\\(["'\\nrt])/g, (_m, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c
  )
  return value.trim() || null
}

/**
 * Finds the metadata object literal and reads its fields.
 *
 * Scans for the brace-balanced block after `metadata:` rather than matching a
 * fixed shape, so a nested object or a comment inside it does not truncate the
 * search at the wrong closing brace.
 */
export function parsePluginMetadata(source: string): PluginMetadata {
  const empty: PluginMetadata = { name: null, description: null, version: null }
  if (!source) return empty

  const start = /["']?metadata["']?\s*:\s*\{/.exec(source)
  if (!start) return empty

  const from = start.index + start[0].length - 1
  let depth = 0
  let end = -1
  for (let i = from; i < source.length; i++) {
    const char = source[i]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return empty

  const block = source.slice(from, end + 1)
  return {
    name: field(block, 'name'),
    description: field(block, 'description'),
    version: field(block, 'version')
  }
}

/**
 * True when a filename is a plain name inside the plugins folder.
 *
 * The value arrives over IPC from the renderer, so it is untrusted: without this
 * a crafted name could walk out of the plugins directory and load any file on
 * disk into the main process.
 */
export function isSafePluginFilename(filename: string): boolean {
  if (!filename || filename.length > 128) return false
  if (!filename.endsWith('.js')) return false
  // No separators, no traversal, no drive letters, no leading dot.
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(filename) && !filename.includes('..')
}
