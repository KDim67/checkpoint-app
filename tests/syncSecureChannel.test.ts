import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { acceptSecure, connectSecure, HandshakeError, type SecureChannel } from '../src/main/sync/secureChannel'
import { calculateGenerator, lvCat, sampleScalar, scalarMult } from '../src/shared/cpace'

const CODE = '482913'
const servers: net.Server[] = []
const sockets: net.Socket[] = []

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const server of servers.splice(0)) server.close()
})

/** a listener on a free local port */
function listen(onSocket: (socket: net.Socket) => void): Promise<number> {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      sockets.push(socket)
      onSocket(socket)
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })
}

const dial = (port: number): net.Socket => {
  const socket = net.connect(port, '127.0.0.1')
  sockets.push(socket)
  return socket
}

/** sits between the two, records what crosses, and may rewrite the lines the host sends */
async function proxy(target: number, rewrite: (line: string, index: number) => string[] = line => [line]): Promise<{ port: number; wire: () => string }> {
  let wire = ''
  const port = await listen(client => {
    const host = dial(target)
    let buffer = ''
    let index = 0
    client.on('data', chunk => { wire += chunk.toString('latin1'); host.write(chunk) })
    host.on('data', chunk => {
      wire += chunk.toString('latin1')
      buffer += chunk.toString('latin1')
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        for (const line of rewrite(buffer.slice(0, newline), index++)) client.write(`${line}\n`)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    })
    client.on('close', () => host.destroy())
    host.on('close', () => client.destroy())
  })
  return { port, wire: () => wire }
}

/** a host that answers every line with "echo <line>" */
async function echoHost(code = CODE): Promise<{ port: number; failure: Promise<HandshakeError> }> {
  let failed: (error: HandshakeError) => void = () => {}
  const failure = new Promise<HandshakeError>(resolve => { failed = resolve })
  const port = await listen(socket => {
    acceptSecure(socket, code).then(channel => {
      channel.onLine(line => channel.send(`echo ${line}`))
    }).catch(error => failed(error))
  })
  return { port, failure }
}

const lines = (channel: SecureChannel, count: number): Promise<string[]> => new Promise(resolve => {
  const got: string[] = []
  channel.onLine(line => {
    got.push(line)
    if (got.length === count) resolve(got)
  })
})

const closed = (channel: SecureChannel): Promise<Error | null> => new Promise(resolve => channel.onClose(resolve))

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'paired'
  } catch (error) {
    return error instanceof HandshakeError ? error.reason : `other: ${String(error)}`
  }
}

describe('local-network sync over CPace', () => {
  it('pairs with the same code and carries lines both ways, in order', async () => {
    const { port } = await echoHost()
    const channel = await connectSecure(dial(port), CODE)
    const replies = lines(channel, 3)
    channel.send('one')
    channel.send('two, with a comma and ünïcode')
    channel.send('three')
    expect(await replies).toStrictEqual(['echo one', 'echo two, with a comma and ünïcode', 'echo three'])
  })

  it('never puts the code, or anything sent, on the wire where someone could read it', async () => {
    const host = await echoHost()
    const relay = await proxy(host.port)
    const channel = await connectSecure(dial(relay.port), CODE)
    const reply = lines(channel, 1)
    channel.send('sync-db-payload:{"title":"Private plans"}')
    await reply
    const wire = relay.wire()
    expect(wire).toContain('checkpoint-sync 2 ')
    expect(wire).not.toContain(CODE)
    expect(wire).not.toContain('Private plans')
    expect(wire).not.toContain('sync-db-payload')
  })

  it('refuses a wrong code on both sides, and each says the code did not match', async () => {
    const host = await echoHost()
    expect(await reasonOf(connectSecure(dial(host.port), '000000'))).toBe('wrong-code')
    expect((await host.failure).reason).toBe('wrong-code')
  })

  it('stops at a message changed on the way', async () => {
    const host = await echoHost()
    // the hello, the host's share and its confirmation come first; the fifth line is the second reply
    const relay = await proxy(host.port, (line, i) => [i === 4 ? `${line.slice(0, 5)}${line[5] === 'A' ? 'B' : 'A'}${line.slice(6)}` : line])
    const channel = await connectSecure(dial(relay.port), CODE)
    const first = lines(channel, 1)
    const end = closed(channel)
    channel.send('one')
    channel.send('two')
    expect(await first).toStrictEqual(['echo one'])
    expect((await end)?.message).toContain('integrity check')
  })

  it('stops at a message played twice', async () => {
    const host = await echoHost()
    const relay = await proxy(host.port, (line, i) => (i === 3 ? [line, line] : [line]))
    const channel = await connectSecure(dial(relay.port), CODE)
    const first = lines(channel, 1)
    const end = closed(channel)
    channel.send('one')
    expect(await first).toStrictEqual(['echo one'])
    expect((await end)?.message).toContain('integrity check')
  })

  it('tells a computer on the older, unencrypted protocol to update', async () => {
    const port = await listen(socket => socket.write('auth-challenge:abc123\n'))
    const attempt = connectSecure(dial(port), CODE)
    await expect(attempt).rejects.toMatchObject({ reason: 'older-peer', message: expect.stringContaining('Update it') })
  })

  it('gives up on a computer that connects and never pairs', async () => {
    let result: Promise<string> = Promise.resolve('none')
    const port = await listen(socket => { result = reasonOf(acceptSecure(socket, CODE, 150)) })
    dial(port)
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(await result).toBe('timeout')
  })

  it('refuses the identity point as a pairing share', async () => {
    let result: Promise<string> = Promise.resolve('none')
    const port = await listen(socket => { result = reasonOf(acceptSecure(socket, CODE)) })
    const attacker = dial(port)
    attacker.once('data', () => attacker.write(`cpace-a ${randomBytes(16).toString('base64')} ${Buffer.alloc(32).toString('base64')}\n`))
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(await result).toBe('bad-message')
  })

  it('sends nothing to a host that cannot prove it has the code', async () => {
    // plays a host with another code and skips checking the other side's proof
    const port = await listen(socket => {
      const sidB = randomBytes(16)
      socket.write(`checkpoint-sync 2 ${sidB.toString('base64')}\n`)
      socket.on('data', chunk => {
        const [kind, sidA] = chunk.toString('latin1').trim().split(' ')
        if (kind === 'cpace-a') {
          const ci = lvCat(Buffer.from('checkpoint local sync'), Buffer.from('initiator: client'), Buffer.from('responder: host'))
          const yb = scalarMult(sampleScalar(), calculateGenerator(Buffer.from('111111'), ci, Buffer.concat([sidB, Buffer.from(sidA, 'base64')])))
          socket.write(`cpace-b ${Buffer.from(yb).toString('base64')}\n`)
        } else if (kind === 'confirm') {
          socket.write(`confirm ${randomBytes(64).toString('base64')}\n`)
        }
      })
    })
    expect(await reasonOf(connectSecure(dial(port), CODE))).toBe('unverified')
  })
})
