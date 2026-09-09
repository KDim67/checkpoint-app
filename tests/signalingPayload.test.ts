import { describe, it, expect } from 'vitest'
import { readSignalingMessage, signalingPublishError } from '../src/shared/signalingPayload'

// These are real frames captured off https://ntfy.sh/<topic>/sse. The body of a
// published message arrives under `message`; there is no `text` field, which is
// what both P2P coordinators used to read. Every offer and answer was dropped
// on arrival, so the host sat on "Waiting for client connection..." while the
// client sat on "Offer sent. Awaiting host pairing...".

const OPEN_FRAME = '{"id":"iCPzX7pWWtOu","time":1757372400,"event":"open","topic":"checkpoint-collab-abc"}'
const KEEPALIVE_FRAME = '{"id":"kA9","time":1757372460,"event":"keepalive","topic":"checkpoint-collab-abc"}'
const OFFER_FRAME =
  '{"id":"mQ1","time":1757372401,"expires":1757415601,"event":"message",' +
  '"topic":"checkpoint-collab-abc","title":"client-offer","message":"ENCRYPTED-OFFER-BLOB"}'
const ANSWER_FRAME =
  '{"id":"mQ2","time":1757372402,"expires":1757415602,"event":"message",' +
  '"topic":"checkpoint-collab-abc","title":"host-reply","message":"ENCRYPTED-ANSWER-BLOB"}'

describe('readSignalingMessage', () => {
  it('reads the body of a client offer', () => {
    expect(readSignalingMessage(OFFER_FRAME)).toEqual({
      title: 'client-offer',
      body: 'ENCRYPTED-OFFER-BLOB'
    })
  })

  it('reads the body of a host reply', () => {
    expect(readSignalingMessage(ANSWER_FRAME)).toEqual({
      title: 'host-reply',
      body: 'ENCRYPTED-ANSWER-BLOB'
    })
  })

  it('ignores the stream frames that carry no message', () => {
    expect(readSignalingMessage(OPEN_FRAME)).toBeNull()
    expect(readSignalingMessage(KEEPALIVE_FRAME)).toBeNull()
  })

  it('is null for anything unparseable, so a bad frame cannot throw in the handler', () => {
    for (const junk of ['', 'not json', '[]', 'null', '{"event":"message"}']) {
      expect(readSignalingMessage(junk)).toBeNull()
    }
  })

  it('treats a missing title as untitled rather than dropping the frame', () => {
    const untitled =
      '{"id":"m3","event":"message","topic":"t","message":"BLOB"}'
    expect(readSignalingMessage(untitled)).toEqual({ title: '', body: 'BLOB' })
  })
})

// A publish that never landed used to look exactly like a peer who had not
// joined yet: the panel said the offer was sent and then waited forever.
describe('signalingPublishError', () => {
  it('is null for anything the server accepted', () => {
    for (const ok of [200, 201, 204]) expect(signalingPublishError(ok)).toBeNull()
  })

  it('names rate limiting, which is what a shared free server does first', () => {
    expect(signalingPublishError(429)).toMatch(/rate limiting/i)
  })

  it('names an oversized payload', () => {
    expect(signalingPublishError(413)).toMatch(/too large/i)
  })

  it('still reports a status it has no specific wording for', () => {
    expect(signalingPublishError(500)).toBe('The signalling server refused the handshake (HTTP 500).')
    expect(signalingPublishError(404)).toContain('404')
  })
})
