/** ntfy sends the body as message, not text; open/keepalive frames come back null */

interface SignalingMessage {
  /** Title header, or '' */
  title: string
  /** encrypted SDP */
  body: string
}

/** null means it landed; unchecked publishes left peers waiting on nothing */
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
