import { describe, it, expect } from 'vitest'
import {
  STUN_SERVERS, turnIceServer, iceServersWith, describeTurnSettings
} from '../src/shared/iceConfig'

// a relay decides whether symmetric-NAT users sync at all, and it's typed credentials

describe('building a relay entry', () => {
  it('takes a turn: URL with credentials', () => {
    expect(turnIceServer({ url: 'turn:relay.example.com:3478', username: 'u', credential: 'p' }))
      .toEqual({ urls: 'turn:relay.example.com:3478', username: 'u', credential: 'p' })
  })

  it('takes turns: as well, which is the TLS one', () => {
    expect(turnIceServer({ url: 'turns:relay.example.com:5349', username: 'u', credential: 'p' })).not.toBeNull()
  })

  it('does not care how the scheme was capitalised', () => {
    expect(turnIceServer({ url: 'TURN:relay.example.com:3478', username: 'u', credential: 'p' })).not.toBeNull()
  })

  it('allows a relay with no credentials, which some are', () => {
    expect(turnIceServer({ url: 'turn:open.example.com:3478' }))
      .toEqual({ urls: 'turn:open.example.com:3478' })
  })

  it('refuses a half-filled form rather than sending a broken entry', () => {
    // half-filled, not a relay
    expect(turnIceServer({ url: 'turn:r.example.com', username: 'u' })).toBeNull()
    expect(turnIceServer({ url: 'turn:r.example.com', credential: 'p' })).toBeNull()
  })

  it('refuses a stun: URL in the relay field', () => {
    // STUN is what fails when you need a relay
    expect(turnIceServer({ url: 'stun:stun.example.com:3478' })).toBeNull()
  })

  it('refuses anything that is not a relay URL at all', () => {
    expect(turnIceServer({ url: 'https://example.com' })).toBeNull()
    expect(turnIceServer({ url: 'relay.example.com' })).toBeNull()
  })

  it('is nothing when nothing was entered', () => {
    expect(turnIceServer({})).toBeNull()
    expect(turnIceServer({ url: '   ' })).toBeNull()
  })

  it('ignores whitespace someone pasted in with it', () => {
    expect(turnIceServer({ url: '  turn:r.example.com  ', username: ' u ', credential: ' p ' }))
      .toEqual({ urls: 'turn:r.example.com', username: 'u', credential: 'p' })
  })
})

describe('the list handed to a peer connection', () => {
  it('is STUN alone until a relay is configured', () => {
    expect(iceServersWith({})).toEqual(STUN_SERVERS)
  })

  it('keeps STUN and adds the relay, rather than replacing it', () => {
    // direct routes are cheaper, STUN still goes first
    const servers = iceServersWith({ url: 'turn:r.example.com', username: 'u', credential: 'p' })
    expect(servers).toHaveLength(STUN_SERVERS.length + 1)
    expect(servers.slice(0, STUN_SERVERS.length)).toEqual(STUN_SERVERS)
    expect(servers[servers.length - 1].urls).toBe('turn:r.example.com')
  })

  it('does not hand over a half-filled relay', () => {
    expect(iceServersWith({ url: 'turn:r.example.com', username: 'u' })).toEqual(STUN_SERVERS)
  })

  it('gives a fresh array, so a caller cannot edit the constant', () => {
    const servers = iceServersWith({})
    servers.push({ urls: 'stun:somewhere.else' })
    expect(STUN_SERVERS).toHaveLength(2)
  })
})

describe('what the form tells the user', () => {
  it('says nothing when the field is empty', () => {
    expect(describeTurnSettings({})).toBe('')
  })

  it('says nothing when the entry is usable', () => {
    expect(describeTurnSettings({ url: 'turn:r.example.com', username: 'u', credential: 'p' })).toBe('')
  })

  it('explains a wrong scheme rather than silently ignoring it', () => {
    expect(describeTurnSettings({ url: 'https://r.example.com' })).toContain('turn:')
  })

  it('points out a missing half of the credentials', () => {
    expect(describeTurnSettings({ url: 'turn:r.example.com', username: 'u' })).toContain('no password')
    expect(describeTurnSettings({ url: 'turn:r.example.com', credential: 'p' })).toContain('no username')
  })
})
