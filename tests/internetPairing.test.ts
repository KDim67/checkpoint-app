import { describe, expect, it } from 'vitest'
import {
  answerGuestPairing,
  newInternetCode,
  openPairing,
  parseInternetCode,
  roomTopic,
  ROOM_ALPHABET,
  sealPairing,
  startGuestPairing,
  type InternetCode
} from '../src/shared/internetPairing'

const code = (text: string): InternetCode => {
  const parsed = parseInternetCode(text)
  if (!parsed) throw new Error(`not a code: ${text}`)
  return parsed
}

/** both sides of one pairing, the way the room carries it */
async function pair(guestCode: string, hostCode: string, purpose: 'sync' | 'collab' = 'sync') {
  const guest = startGuestPairing(code(guestCode), purpose)
  const answer = await answerGuestPairing(code(hostCode), purpose, guest.hello)
  if (!answer) throw new Error('the host refused the hello')
  const guestKeys = await guest.finish(answer.reply)
  if (!guestKeys) throw new Error('the guest refused the reply')
  return { guest: guestKeys, host: answer.keys, hello: guest.hello, reply: answer.reply }
}

describe('internet pairing codes', () => {
  it('are four room characters without look-alikes, then six digits', () => {
    for (let i = 0; i < 200; i++) {
      const made = newInternetCode()
      expect(made).toMatch(/^[2-9A-HJKMNP-Z]{4}-[1-9]\d{5}$/)
      expect(parseInternetCode(made)).not.toBeNull()
    }
    expect(ROOM_ALPHABET).not.toMatch(/[01ILO]/)
  })

  it('read however they are typed, and refuse anything else, an old six-digit code included', () => {
    expect(parseInternetCode(' k7qd 482913 ')).toStrictEqual({ room: 'K7QD', secret: '482913' })
    expect(parseInternetCode('K7QD482913')).toStrictEqual({ room: 'K7QD', secret: '482913' })
    expect(parseInternetCode('482913')).toBeNull()
    expect(parseInternetCode('K7OD-482913')).toBeNull()
    expect(parseInternetCode('K7QD-48291')).toBeNull()
    expect(parseInternetCode('K7QD-4829133')).toBeNull()
  })

  it('name the room from its first part only, so the room says nothing about the secret', () => {
    expect(roomTopic('sync', 'K7QD')).toBe(roomTopic('sync', code('K7QD-111111').room))
    expect(roomTopic('sync', 'K7QD')).not.toBe(roomTopic('collab', 'K7QD'))
    expect(roomTopic('sync', 'K7QD')).toMatch(/^checkpoint-sync-v3-[0-9a-f]{32}$/)
  })
})

describe('pairing through a public room', () => {
  it('gives both sides matching keys, one per direction, with the same code', async () => {
    const { guest, host } = await pair('K7QD-482913', 'K7QD-482913')
    const offer = await sealPairing(guest.send, '{"sdp":"offer"}')
    expect(await openPairing(host.receive, offer)).toBe('{"sdp":"offer"}')
    const answer = await sealPairing(host.send, '{"sdp":"answer"}')
    expect(await openPairing(guest.receive, answer)).toBe('{"sdp":"answer"}')
    // a message can't be bounced back at the side that sent it
    expect(await openPairing(guest.receive, offer)).toBeNull()
  })

  it('never puts the secret in what crosses the room', async () => {
    const { hello, reply } = await pair('K7QD-482913', 'K7QD-482913')
    const seen = atob(hello) + atob(reply) + hello + reply
    expect(seen).not.toContain('482913')
  })

  it('cannot be opened by a host with another secret, or in another room', async () => {
    const wrongSecret = await pair('K7QD-482913', 'K7QD-482914')
    expect(await openPairing(wrongSecret.host.receive, await sealPairing(wrongSecret.guest.send, 'offer'))).toBeNull()
    const otherPurpose = startGuestPairing(code('K7QD-482913'), 'collab')
    const answer = await answerGuestPairing(code('K7QD-482913'), 'sync', otherPurpose.hello)
    const keys = answer && await otherPurpose.finish(answer.reply)
    expect(keys && await openPairing(answer.keys.receive, await sealPairing(keys.send, 'offer'))).toBeNull()
  })

  it('refuses a changed message, an identity share and text that is not a message', async () => {
    const { guest, host } = await pair('K7QD-482913', 'K7QD-482913')
    const sealed = await sealPairing(guest.send, 'offer')
    const bytes = Uint8Array.from(atob(sealed), c => c.charCodeAt(0))
    bytes[bytes.length - 1] ^= 1
    expect(await openPairing(host.receive, btoa(String.fromCharCode(...bytes)))).toBeNull()
    expect(await openPairing(host.receive, 'not base64 at all!')).toBeNull()
    const identity = btoa(String.fromCharCode(...new Uint8Array(48)))
    expect(await answerGuestPairing(code('K7QD-482913'), 'sync', identity)).toBeNull()
    expect(await startGuestPairing(code('K7QD-482913'), 'sync').finish(btoa(String.fromCharCode(...new Uint8Array(32))))).toBeNull()
  })
})
