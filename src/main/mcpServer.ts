/** in main since better-sqlite3 is built for electron's ABI; authed, unlike the webhook gateway */

import http from 'http'
import crypto from 'crypto'
import { app } from 'electron'
import { extname } from 'path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getContextSlugs, getSetting, setSetting } from './db'
import { readMediaBuffer } from './mediaService'
import { listNotes, readNote } from './notesFsService'
import { MCP_DEFAULT_PORT } from '../shared/ports'
import { registerBoardTools } from './mcp/tools/board'
import { registerItemTools } from './mcp/tools/items'
import { registerNoteTools } from './mcp/tools/notes'
import { registerWallTools } from './mcp/tools/walls'
import { registerOrganisationTools } from './mcp/tools/organisation'
import { registerSubtaskTools } from './mcp/tools/subtasks'
import { registerRecurrenceTools } from './mcp/tools/recurrences'
import { registerRenewalTools } from './mcp/tools/renewals'
import { registerReferenceTools } from './mcp/tools/reference'
import { registerTrackingTools } from './mcp/tools/tracking'

// re-exported for the dynamic importers in index.ts
export { MCP_DEFAULT_PORT }
const TOKEN_SETTING_KEY = 'mcp_auth_token'
const MAX_REQUEST_BYTES = 16 * 1024 * 1024
export { setMcpDataChangedHandler } from './mcp/toolKit'

/** anything else is a rebinding attempt */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const RESOURCE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

const SERVER_INSTRUCTIONS = [
  'Checkpoint is a local-first workspace app with Kanban boards, backlog tasks, logs, markdown notes, walls (freeform canvases), renewals, recurrences, cheatsheets, and assistant memories.',
  'Always call list_workspaces first to discover valid workspace slugs (context).',
  'Cards, tasks, and logs live in SQLite (query_items, create_item, update_item, archive_item); markdown notes live as .md files (notes, write_note).',
  'On walls, placement/update coordinates (x, y) specify the CENTRE of an item, while get_wall reports top-left corners alongside width and height.',
  'Use read_wall_image or the checkpoint://media/{filename} resource to inspect image items stored on walls.'
].join(' ')

let server: http.Server | null = null
let activePort: number | null = null

/** encrypted at rest via SECRET_SETTING_KEYS, like the AI keys */
export function getOrCreateMcpToken(): string {
  const existing = getSetting<string>(TOKEN_SETTING_KEY, '')
  if (existing) return existing
  const token = crypto.randomBytes(32).toString('hex')
  setSetting(TOKEN_SETTING_KEY, token)
  return token
}

export function regenerateMcpToken(): string {
  const token = crypto.randomBytes(32).toString('hex')
  setSetting(TOKEN_SETTING_KEY, token)
  return token
}

/** so localhost:9990 and localhost both match */
function hostnameOf(headerValue: string | undefined): string {
  if (!headerValue) return ''
  const value = headerValue.trim()
  // IPv6 literals are bracketed, don't split on their colons
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1).toLowerCase()
  return value.split(':')[0].toLowerCase()
}

/** DNS rebinding defence behind the token; the SDK moved its own check to Express middleware */
function isOriginAllowed(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(req.headers.host))) return false

  const origin = req.headers.origin
  // non-browser clients send no Origin, the normal case
  if (!origin) return true
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** constant-time, no timing leak */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return false
  return tokenMatches(header.slice('Bearer '.length).trim(), getOrCreateMcpToken())
}

function registerResources(mcp: McpServer): void {
  mcp.registerResource(
    'workspaces',
    'checkpoint://workspaces',
    {
      title: 'Workspaces',
      description: 'List of all Checkpoint workspace slugs.',
      mimeType: 'application/json'
    },
    async uri => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ workspaces: getContextSlugs() }, null, 2) }]
    })
  )

  mcp.registerResource(
    'note',
    new ResourceTemplate('checkpoint://notes/{title}', {
      list: async () => ({
        resources: (await listNotes()).map(n => ({
          uri: `checkpoint://notes/${encodeURIComponent(n.title)}`,
          name: n.title,
          description: n.excerpt || undefined,
          mimeType: 'text/markdown'
        }))
      })
    }),
    {
      title: 'Markdown Note',
      description: 'Read a Checkpoint markdown note by title.',
      mimeType: 'text/markdown'
    },
    async (uri, variables) => {
      const title = decodeURIComponent(String(variables.title ?? ''))
      const text = await readNote(title)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    }
  )

  mcp.registerResource(
    'media',
    new ResourceTemplate('checkpoint://media/{filename}', { list: undefined }),
    {
      title: 'Wall Media Asset',
      description: 'Binary or SVG media asset referenced by a wall item.'
    },
    async (uri, variables) => {
      const filename = decodeURIComponent(String(variables.filename ?? ''))
      const buf = readMediaBuffer(filename)
      if (!buf) {
        throw new Error(`Media file "${filename}" not found.`)
      }
      const ext = extname(filename).toLowerCase()
      const mimeType = RESOURCE_MIME_BY_EXT[ext] ?? 'application/octet-stream'
      if (ext === '.svg') {
        return { contents: [{ uri: uri.href, mimeType, text: buf.toString('utf8') }] }
      }
      return { contents: [{ uri: uri.href, mimeType, blob: buf.toString('base64') }] }
    }
  )
}

export function buildMcpServer(options: { readOnly?: boolean } = {}): McpServer {
  const readOnly = options.readOnly ?? getSetting<string>('mcp_read_only', 'false') === 'true'
  const instructions = readOnly
    ? `${SERVER_INSTRUCTIONS} Note: Server is currently in READ-ONLY mode; write tools are disabled.`
    : SERVER_INSTRUCTIONS

  const mcp = new McpServer(
    { name: 'checkpoint', version: app.getVersion() },
    { instructions }
  )

  const toolHost: McpServer = readOnly
    ? ({
        registerTool: (
          name: string,
          config: Parameters<McpServer['registerTool']>[1],
          cb: Parameters<McpServer['registerTool']>[2]
        ) => {
          if ((config as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint !== true) {
            return undefined
          }
          return mcp.registerTool(name, config, cb)
        }
      } as unknown as McpServer)
    : mcp

  registerBoardTools(toolHost)
  registerItemTools(toolHost)
  registerNoteTools(toolHost)
  registerWallTools(toolHost)
  registerOrganisationTools(toolHost)
  registerSubtaskTools(toolHost)
  registerRecurrenceTools(toolHost)
  registerRenewalTools(toolHost)
  registerReferenceTools(toolHost)
  registerTrackingTools(toolHost)
  registerResources(mcp)

  return mcp
}

function startMcpServer(requestedPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(activePort ?? requestedPort)
      return
    }

    const port = requestedPort > 0 ? requestedPort : MCP_DEFAULT_PORT

    const httpServer = http.createServer(async (req, res) => {
      // host check before body or token, a rebinding attempt learns nothing
      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      if (!isAuthorized(req)) {
        // vague on purpose, don't say which half was wrong
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      // stateless transport handles JSON-RPC POST requests only
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
        res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST for stateless MCP requests.' }))
        return
      }
      const contentLength = Number(req.headers['content-length'] ?? 0)
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Payload Too Large' }))
        return
      }

      try {
        // stateless, a session map in a days-long process is a leak
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        const mcp = buildMcpServer()
        res.on('close', () => {
          transport.close().catch(() => {})
          mcp.close().catch(() => {})
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res)
      } catch (err) {
        console.error('[mcp] Request failed:', err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      }
    })

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      server = null
      activePort = null
      // fail visibly, a client pointed at a port we didn't get is worse
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use. Choose another port in Settings.`)
          : err
      )
    })

    httpServer.listen(port, '127.0.0.1', () => {
      server = httpServer
      activePort = port
      console.log(`[mcp] MCP server listening on http://127.0.0.1:${port}/`)
      resolve(port)
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  if (!server) return
  await new Promise<void>(resolve => {
    server?.close(() => resolve())
    server = null
    activePort = null
  })
  console.log('[mcp] MCP server stopped.')
}

export async function toggleMcpServer(active: boolean, port: number): Promise<number | null> {
  await stopMcpServer()
  if (!active) return null
  return startMcpServer(port)
}

export function getMcpPort(): number | null {
  return activePort
}
