/** in main since better-sqlite3 is built for electron's ABI; authed, unlike the webhook gateway */

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

// re-exported for the dynamic importers in index.ts
export { MCP_DEFAULT_PORT }
const TOKEN_SETTING_KEY = 'mcp_auth_token'
export { setMcpDataChangedHandler } from './mcp/toolKit'

/** anything else is a rebinding attempt */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

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
