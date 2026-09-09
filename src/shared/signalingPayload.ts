/**
 * Reading one frame off the ntfy signalling stream.
 *
 * Both P2P coordinators used to reach for `payload.text`, which ntfy has never
 * sent: a published body arrives under `message`. Every offer and every answer
 * was therefore dropped the moment it arrived, and the two sides sat waiting
 * for each other until someone gave up. Parsing lives here, with tests against
 * real captured frames, so the field name is asserted somewhere rather than
 * assumed in two handlers.
 *
 * The stream also carries `open` and `keepalive` frames that have no body at
 * all. Those are not errors, so they come back as null like anything else the
 * caller should skip.
 */

export interface SignalingMessage {
  /** The publisher's Title header, or '' when it sent none. */
  title: string
  /** The published body: an encrypted SDP. */
  body: string
}

/**
 * Whether a publish to the signalling lobby actually landed, in words the panel
 * can show. Null means it did.
 *
 * Both coordinators used to fire the POST and announce success without looking
 * at the response, so a rejected publish left the peer waiting on a handshake
 * that had never been sent, indistinguishable from a peer who had not joined.
 */
export function signalingPublishError(status: number): string | null {
  if (status >= 200 && status < 300) return null
  if (status === 429) {
    return 'The signalling server is rate limiting this passcode. Wait a minute, then try again.'
  }
  if (status === 413) {
    return 'The signalling server rejected the connection details as too large.'
  }
  return `The signalling server refused the handshake (HTTP ${status}).`
}

export function readSignalingMessage(raw: string): SignalingMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const frame = parsed as Record<string, unknown>

  if (frame.event !== 'message') return null
  if (typeof frame.message !== 'string' || frame.message === '') return null

  return {
    title: typeof frame.title === 'string' ? frame.title : '',
    body: frame.message
  }
}
