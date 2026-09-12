/**
 * Which ICE servers a peer connection should try.
 *
 * STUN tells each peer what its own public address looks like, which is enough
 * when at least one end is behind an ordinary NAT. Two peers behind symmetric
 * NATs, common on mobile tethering and corporate networks, cannot see each
 * other at all without a TURN relay carrying the traffic between them.
 *
 * There is no free public TURN worth pointing at, and running one costs money
 * and a machine, so the app does not ship one. Instead the user can point at
 * their own: a coturn on a VPS, or one of the hosted services. Nothing is sent
 * anywhere until they fill it in.
 *
 * `RTCIceServer` is a DOM type and this module is compiled for the main
 * process too, so the shape is declared here. It is structurally what
 * `RTCPeerConnection` wants.
 */

export interface IceServer {
  urls: string
  username?: string
  credential?: string
}

/** Public STUN, used whether or not a relay is configured. */
export const STUN_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

interface TurnSettings {
  url?: string
  username?: string
  credential?: string
}

/**
 * A TURN entry from what the user typed, or null if there is not enough to
 * make one.
 *
 * Only `turn:` and `turns:` are accepted. A `stun:` URL in this field would be
 * silently useless, since STUN is what already does not work in the case a
 * relay is for, and anything else is a typo worth ignoring rather than
 * handing to the browser.
 */
export function turnIceServer(settings: TurnSettings): IceServer | null {
  const url = (settings.url ?? '').trim()
  if (!url) return null
  if (!/^turns?:/i.test(url)) return null

  const username = (settings.username ?? '').trim()
  const credential = (settings.credential ?? '').trim()

  // A relay with no credentials is possible but vanishingly rare, and the
  // usual cause is a half-filled form. Both or neither.
  if ((username && !credential) || (!username && credential)) return null

  return username
    ? { urls: url, username, credential }
    : { urls: url }
}

/** The full list to hand a peer connection: STUN always, a relay if there is one. */
export function iceServersWith(settings: TurnSettings): IceServer[] {
  const relay = turnIceServer(settings)
  return relay ? [...STUN_SERVERS, relay] : [...STUN_SERVERS]
}

/** What to tell the user about what they typed. Empty when there is nothing to say. */
export function describeTurnSettings(settings: TurnSettings): string {
  const url = (settings.url ?? '').trim()
  if (!url) return ''
  if (!/^turns?:/i.test(url)) return 'A relay URL has to start with turn: or turns:'

  const username = (settings.username ?? '').trim()
  const credential = (settings.credential ?? '').trim()
  if (username && !credential) return 'This relay has a username but no password.'
  if (!username && credential) return 'This relay has a password but no username.'
  return ''
}
