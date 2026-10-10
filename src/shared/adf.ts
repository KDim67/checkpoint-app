/** Jira's document format as Markdown, for showing a description on a card; one way, nothing is sent back */

interface AdfNode {
  type?: unknown
  text?: unknown
  content?: unknown
  attrs?: Record<string, unknown>
  marks?: unknown
}

// a real document is a few levels deep; this only stops a hostile one
const MAX_DEPTH = 40

const nodeOf = (raw: unknown): AdfNode => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as AdfNode) : {})
const childrenOf = (node: AdfNode): AdfNode[] => (Array.isArray(node.content) ? node.content.map(nodeOf) : [])
const attr = (node: AdfNode, name: string): unknown => node.attrs?.[name]
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const safeHref = (href: string): boolean => /^(https?:|mailto:)/i.test(href)

function marked(text: string, marks: unknown): string {
  if (!Array.isArray(marks) || !text) return text
  const kinds = marks.map(nodeOf)
  if (kinds.some(m => m.type === 'code')) return `\`${text}\``
  let out = text
  if (kinds.some(m => m.type === 'strong')) out = `**${out}**`
  if (kinds.some(m => m.type === 'em')) out = `_${out}_`
  if (kinds.some(m => m.type === 'strike')) out = `~~${out}~~`
  const link = kinds.find(m => m.type === 'link')
  const href = link ? str(attr(link, 'href')) : ''
  if (href && safeHref(href)) out = `[${out}](${href})`
  return out
}

function inline(nodes: AdfNode[], depth: number): string {
  if (depth > MAX_DEPTH) return ''
  return nodes.map(n => {
    switch (n.type) {
      case 'text':
        return marked(str(n.text), n.marks)
      case 'hardBreak':
        return '\n'
      case 'mention':
        return str(attr(n, 'text')) || '@someone'
      case 'emoji':
        return str(attr(n, 'text')) || str(attr(n, 'shortName'))
      case 'inlineCard': {
        const url = str(attr(n, 'url'))
        return safeHref(url) ? `<${url}>` : ''
      }
      case 'date': {
        const at = Number(attr(n, 'timestamp'))
        return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : ''
      }
      case 'status':
        return str(attr(n, 'text'))
      default:
        return inline(childrenOf(n), depth + 1)
    }
  }).join('')
}

/** each line of a block under a prefix, such as a quote's marker or a list item's indent */
const prefixed = (text: string, first: string, rest: string): string =>
  text.split('\n').map((line, i) => (i === 0 ? first + line : line ? rest + line : rest.trimEnd())).join('\n')

function list(items: AdfNode[], marker: (i: number) => string, depth: number): string {
  return items.map((item, i) => {
    const m = marker(i)
    // an item's paragraph and its nested list sit on consecutive lines, as a tight list
    const inner = childrenOf(item).map(child => block(child, depth + 1)).filter(Boolean).join('\n')
    return prefixed(inner, m, ' '.repeat(m.length))
  }).join('\n')
}

function cellText(cell: AdfNode, depth: number): string {
  return childrenOf(cell).map(child => block(child, depth + 1)).join(' ').replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function table(node: AdfNode, depth: number): string {
  const rows = childrenOf(node).map(row => childrenOf(row).map(cell => cellText(cell, depth)))
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map(r => r.length))
  const line = (cells: string[]): string => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
  return [line(rows[0]), line(Array<string>(width).fill('---')), ...rows.slice(1).map(line)].join('\n')
}

function block(node: AdfNode, depth: number): string {
  if (depth > MAX_DEPTH) return ''
  switch (node.type) {
    case 'paragraph':
      return inline(childrenOf(node), depth)
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attr(node, 'level')) || 1))
      return `${'#'.repeat(level)} ${inline(childrenOf(node), depth)}`
    }
    case 'bulletList':
      return list(childrenOf(node), () => '- ', depth)
    case 'orderedList': {
      const start = Number(attr(node, 'order')) || 1
      return list(childrenOf(node), i => `${start + i}. `, depth)
    }
    case 'taskList':
      return childrenOf(node).map(item => (item.type === 'taskItem'
        ? `- [${attr(item, 'state') === 'DONE' ? 'x' : ' '}] ${inline(childrenOf(item), depth)}`
        : block(item, depth + 1))).join('\n')
    case 'codeBlock':
      return `\`\`\`${str(attr(node, 'language'))}\n${childrenOf(node).map(n => str(n.text)).join('')}\n\`\`\``
    case 'blockquote':
    case 'panel':
      return prefixed(blocks(childrenOf(node), depth + 1), '> ', '> ')
    case 'rule':
      return '---'
    case 'table':
      return table(node, depth)
    case 'expand':
    case 'nestedExpand': {
      const title = str(attr(node, 'title'))
      const body = blocks(childrenOf(node), depth + 1)
      return title ? `**${title}**\n\n${body}` : body
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '(an attachment, in Jira)'
    case 'blockCard':
    case 'embedCard': {
      const url = str(attr(node, 'url'))
      return safeHref(url) ? `<${url}>` : ''
    }
    default:
      // a block this doesn't know still shows what it holds
      return node.type === 'text' ? inline([node], depth) : blocks(childrenOf(node), depth + 1)
  }
}

function blocks(nodes: AdfNode[], depth: number): string {
  if (depth > MAX_DEPTH) return ''
  return nodes.map(n => block(n, depth)).filter(Boolean).join('\n\n')
}

export function adfToMarkdown(doc: unknown): string {
  return blocks(childrenOf(nodeOf(doc)), 0).trim()
}
