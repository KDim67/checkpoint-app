/** reads name and version as text; requiring every file made the off switch meaningless */

interface PluginMetadata {
  name: string | null
  description: string | null
  version: string | null
}

/** one string field */
function field(block: string, key: string): string | null {
  // both quote styles and quoted keys, it's JS not JSON
  const match = new RegExp(`["']?${key}["']?\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(block)
  if (!match) return null
  // the escapes that actually appear
  const value = match[2].replace(/\\(["'\\nrt])/g, (_m, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c
  )
  return value.trim() || null
}

/** brace-balanced, so nested objects or comments don't cut it short */
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

/** the name comes over IPC; a crafted one could load any file into main */
export function isSafePluginFilename(filename: string): boolean {
  if (!filename || filename.length > 128) return false
  if (!filename.endsWith('.js')) return false
  // no separators, traversal, drive letters or leading dot
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(filename) && !filename.includes('..')
}
