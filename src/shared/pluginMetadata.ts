/** reads name, version and what a plugin asks for as text; requiring every file made the off switch meaningless */

interface PluginMetadata {
  name: string | null
  description: string | null
  version: string | null
  /** null when the file doesn't say, which asks for nothing */
  permissions: string[] | null
  hosts: string[] | null
}

/** the escapes that actually appear */
const unescape = (value: string): string =>
  value.replace(/\\(["'\\nrt])/g, (_m, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c))

/** index just past a string or comment starting at i, or i when there is none; braces inside either don't count */
function skipLiteral(source: string, i: number): number {
  const char = source[i]
  if (char === '"' || char === "'" || char === '`') {
    let j = i + 1
    while (j < source.length && source[j] !== char) j += source[j] === '\\' ? 2 : 1
    return j + 1
  }
  if (char === '/' && source[i + 1] === '/') {
    const end = source.indexOf('\n', i)
    return end === -1 ? source.length : end
  }
  if (char === '/' && source[i + 1] === '*') {
    const end = source.indexOf('*/', i + 2)
    return end === -1 ? source.length : end + 2
  }
  return i
}

/** from an opening bracket to its partner, or -1 */
function closing(source: string, from: number, open: string, close: string): number {
  let depth = 0
  let i = from
  while (i < source.length) {
    const skipped = skipLiteral(source, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** where key's value starts at the top level of the block; a nested key, or a value that reads like one, can't stand in */
function valueStart(block: string, key: string): number {
  const pattern = new RegExp(`(["']?)${key}\\1\\s*:\\s*`, 'y')
  let depth = 0
  let expectKey = true
  let i = 1
  while (i < block.length - 1) {
    const char = block[i]
    const comment = char === '/' && (block[i + 1] === '/' || block[i + 1] === '*')
    if (depth === 0 && expectKey && !comment && !/\s/.test(char)) {
      pattern.lastIndex = i
      const match = pattern.exec(block)
      if (match) return i + match[0].length
      // some other key, its value comes next
      expectKey = false
    }
    const skipped = skipLiteral(block, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    if (char === '{' || char === '[' || char === '(') depth++
    else if (char === '}' || char === ']' || char === ')') depth--
    else if (char === ',' && depth === 0) expectKey = true
    i++
  }
  return -1
}

/** one string field */
function field(block: string, key: string): string | null {
  const at = valueStart(block, key)
  if (at === -1) return null
  // both quote styles, it's JS not JSON
  const match = /(["'])((?:\\.|(?!\1).)*)\1/y
  match.lastIndex = at
  const found = match.exec(block)
  if (!found) return null
  return unescape(found[2]).trim() || null
}

/** a list of string literals; anything else in it is skipped, never run */
function list(block: string, key: string): string[] | null {
  const at = valueStart(block, key)
  if (at === -1 || block[at] !== '[') return null
  const end = closing(block, at, '[', ']')
  if (end === -1) return null
  const out: string[] = []
  const item = /(["'])((?:\\.|(?!\1).)*)\1/g
  for (const found of block.slice(at + 1, end).matchAll(item)) {
    const value = unescape(found[2]).trim()
    if (value) out.push(value)
  }
  return out
}

export function parsePluginMetadata(source: string): PluginMetadata {
  const empty: PluginMetadata = { name: null, description: null, version: null, permissions: null, hosts: null }
  if (!source) return empty

  const start = /["']?metadata["']?\s*:\s*\{/.exec(source)
  if (!start) return empty

  const from = start.index + start[0].length - 1
  const end = closing(source, from, '{', '}')
  if (end === -1) return empty

  const block = source.slice(from, end + 1)
  return {
    name: field(block, 'name'),
    description: field(block, 'description'),
    version: field(block, 'version'),
    permissions: list(block, 'permissions'),
    hosts: list(block, 'hosts')
  }
}

/** the name comes over IPC; a crafted one could load any file */
export function isSafePluginFilename(filename: string): boolean {
  if (!filename || filename.length > 128) return false
  if (!filename.endsWith('.js')) return false
  // no separators, traversal, drive letters or leading dot
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(filename) && !filename.includes('..')
}
