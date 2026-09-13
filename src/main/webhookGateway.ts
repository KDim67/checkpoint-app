import http from 'http'
import { notify } from './notificationService'
import { Socket } from 'net'
import { z } from 'zod'
import { getDb, createItem } from './db'
import { ensureWebhookToken, offeredToken, tokenMatches } from './webhookAuth'

const WebhookPayloadSchema = z.object({
  context: z.string().min(1, 'Workspace slug cannot be empty'),
  title: z.string().default(''),
  body: z.string().default(''),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(0),
  metadata: z.string().default('{}'),
  due_at: z.number().nullable().optional().default(null)
})

let serverInstance: http.Server | null = null
let currentListeningPort: number | null = null
const activeSockets = new Set<Socket>()

/** resolves with the port it actually bound */
function startWebhookServer(requestedPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (serverInstance) {
      resolve(currentListeningPort || requestedPort)
      return
    }

    let port = requestedPort
    const activePortTries = new Set<number>()

    const tryListen = () => {
      if (activePortTries.has(port)) {
        reject(new Error('Circular port binding retry detected'))
        return
      }
      activePortTries.add(port)

      const server = http.createServer(async (req, res) => {
        const { method, url } = req

        // no CORS: scripts don't need it, and browsers shouldn't reach this
        if (method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
          return
        }

        if (url !== '/api/v1/log' && url !== '/webhook/log' && url !== '/api/v1/task') {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: 'Endpoint Not Found' }))
          return
        }

        // auth after routing, so unauthenticated callers can't map endpoints by response
        if (!tokenMatches(offeredToken(req.headers.authorization), ensureWebhookToken())) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: false,
            error: 'Missing or invalid token. Settings, Features, Local Webhook Gateway shows it.'
          }))
          return
        }

        const type = url === '/api/v1/task' ? 'task' : 'log'

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk)
          }
          const bodyStr = Buffer.concat(chunks).toString()

          let json: unknown
          try {
            json = JSON.parse(bodyStr)
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }))
            return
          }

          const parsed = WebhookPayloadSchema.safeParse(json)
          if (!parsed.success) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: false,
              error: 'Schema Validation Failed',
              details: parsed.error.format()
            }))
            return
          }

          const db = getDb()
          const item = createItem(db, {
            type,
            context: parsed.data.context,
            title: parsed.data.title,
            body: parsed.data.body,
            priority: parsed.data.priority,
            metadata: parsed.data.metadata,
            status: 'open',
            position: Date.now(),
            due_at: parsed.data.due_at
          })

          notify({
            category: 'webhook',
            title: `Checkpoint Webhook Received (${type})`,
            body: parsed.data.title || `Added to context: ${parsed.data.context}`,
            itemId: item?.id
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, item }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Internal Server Error'
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: msg }))
        }
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Webhook port ${port} in use, trying alternative port ${port + 1}...`)
          port++
          server.close()
          setTimeout(tryListen, 25)
        } else {
          reject(err)
        }
      })

      server.on('listening', () => {
        serverInstance = server
        currentListeningPort = port

        // tracked so stop can destroy them
        server.on('connection', (socket) => {
          activeSockets.add(socket)
          socket.on('close', () => {
            activeSockets.delete(socket)
          })
        })

        if (port !== requestedPort) {
          // deduped, a blocked port would warn on every restart
          notify({
            category: 'webhook',
            title: 'Webhook Port Conflict',
            body: `Port ${requestedPort} was blocked. Listening on ${port} instead.`,
            dedupeKey: `webhook-port:${requestedPort}:${port}`,
            dedupeWindowMs: 24 * 60 * 60 * 1000
          })
        }

        resolve(port)
      })

      server.listen(port, '127.0.0.1')
    }

    tryListen()
  })
}

export async function stopWebhookServer(): Promise<void> {
  if (!serverInstance) return

  const serverToClose = serverInstance
  serverInstance = null
  currentListeningPort = null

  for (const socket of activeSockets) {
    socket.destroy()
  }
  activeSockets.clear()

  return new Promise((resolve) => {
    serverToClose.close(() => {
      resolve()
    })
  })
}

export async function toggleWebhookGateway(active: boolean, port: number): Promise<number | null> {
  if (active) {
    const actualPort = await startWebhookServer(port)
    return actualPort
  } else {
    await stopWebhookServer()
    return null
  }
}
