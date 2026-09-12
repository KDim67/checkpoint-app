/**
 * Model Context Protocol server. Exposes workspaces, cards, tasks, notes and
 * board config to MCP clients over loopback while the app runs.
 *
 * In main out of necessity: better-sqlite3 is built against Electron's ABI, so
 * plain Node cannot open checkpoint.db (it fails with ERR_DLOPEN_FAILED). It
 * also means every tool goes through the same `db` functions the app uses.
 *
 * Separate from the webhook gateway, which is unauthenticated with wildcard
 * CORS. Defensible for "append a log line", wrong for something that reads
 * every note.
 */

import http from 'http'
import crypto from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { getSetting, setSetting } from './db'
import { MCP_DEFAULT_PORT } from '../shared/ports'
import { registerBoardTools } from './mcp/tools/board'
import { registerItemTools } from './mcp/tools/items'
import { registerNoteTools } from './mcp/tools/notes'
import { registerWallTools } from './mcp/tools/walls'
import { registerOrganisationTools } from './mcp/tools/organisation'
import { registerSubtaskTools } from './mcp/tools/subtasks'
import { registerViewTools } from './mcp/tools/views'
import { registerRecurrenceTools } from './mcp/tools/recurrences'
import { registerReferenceTools } from './mcp/tools/reference'
import { registerTrackingTools } from './mcp/tools/tracking'

// Re-exported so the dynamic importers in index.ts keep resolving it here.
export { MCP_DEFAULT_PORT }
const TOKEN_SETTING_KEY = 'mcp_auth_token'
export { setMcpDataChangedHandler } from './mcp/toolKit'

/** Host header values accepted. Anything else is a rebinding attempt. */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

let server: http.Server | null = null
let activePort: number | null = null

// Token

/**
 * Returns the bearer token, generating one on first use.
 *
 * The key is registered in secureSettings' SECRET_SETTING_KEYS, so it is
 * encrypted at rest by the OS keychain exactly like the AI provider keys.
 * A token granting full read/write over someone's workspace should not sit in
 * plaintext next to them.
 */
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

// Request guards

/** Strips the port so `localhost:9990` and `localhost` both resolve. */
function hostnameOf(headerValue: string | undefined): string {
  if (!headerValue) return ''
  const value = headerValue.trim()
  // IPv6 literals are bracketed, and their colons must not be split on.
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1).toLowerCase()
  return value.split(':')[0].toLowerCase()
}

/**
 * Defence in depth against DNS rebinding. The bearer token is the primary
 * control. The classic attack targets *unauthenticated* localhost servers, and
 * a page cannot read a token it was never given, but a page should not get as
 * far as presenting credentials in the first place.
 *
 * The SDK's own protection moved to Express middleware in 1.30 and is
 * deprecated on the Node transport, so it is done here rather than pulling a
 * web framework into the main process for one endpoint.
 */
function isOriginAllowed(req: http.IncomingMessage): boolean {
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(req.headers.host))) return false

  const origin = req.headers.origin
  // A non-browser client sends no Origin at all; that is the normal case.
  if (!origin) return true
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Constant-time compare so the token cannot be recovered by timing. */
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

// Server construction

function buildMcpServer(): McpServer {
  const mcp = new McpServer({ name: 'checkpoint', version: '1.0.0' })

  registerBoardTools(mcp)
  registerItemTools(mcp)
  registerNoteTools(mcp)
  registerWallTools(mcp)
  registerOrganisationTools(mcp)
  registerSubtaskTools(mcp)
  registerViewTools(mcp)
  registerRecurrenceTools(mcp)
  registerReferenceTools(mcp)
  registerTrackingTools(mcp)

  return mcp
}

// Lifecycle

function startMcpServer(requestedPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(activePort ?? requestedPort)
      return
    }

    const port = requestedPort > 0 ? requestedPort : MCP_DEFAULT_PORT

    const httpServer = http.createServer(async (req, res) => {
      // Order matters: reject on host before touching the body or the token, so
      // a rebinding attempt learns nothing and costs nothing.
      if (!isOriginAllowed(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      if (!isAuthorized(req)) {
        // Deliberately vague: distinguishing "no token" from "wrong token"
        // tells an attacker which half they got right.
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      try {
        // Stateless: a desktop process runs for days, and a session map is a
        // leak waiting to happen for what is a single local user.
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
      // Surfaced rather than silently rebinding: a client config pointing at a
      // port the server did not get is worse than a visible failure.
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
