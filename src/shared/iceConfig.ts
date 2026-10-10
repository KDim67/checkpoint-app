/** symmetric NATs need TURN and none ships; IceServer declared here since main compiles it too */

export interface IceServer {
  urls: string
  username?: string
  credential?: string
}

/** public STUN, always used */
export const STUN_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

export interface TurnSettings {
  url?: string
  username?: string
  credential?: string
}

/** read and written in main; the credential is a secret, kept off the plain settings channel */
export const TURN_SETTING_KEYS = { url: 'turn_url', username: 'turn_username', credential: 'turn_credential' } as const

/** only turn: and turns:, a stun: URL here is useless */
export function turnIceServer(settings: TurnSettings): IceServer | null {
  const url = (settings.url ?? '').trim()
  if (!url) return null
  if (!/^turns?:/i.test(url)) return null

  const username = (settings.username ?? '').trim()
  const credential = (settings.credential ?? '').trim()

  // both credentials or neither, half means a half-filled form
  if ((username && !credential) || (!username && credential)) return null

  return username
    ? { urls: url, username, credential }
    : { urls: url }
}

/** STUN always, a relay if there is one */
export function iceServersWith(settings: TurnSettings): IceServer[] {
  const relay = turnIceServer(settings)
  return relay ? [...STUN_SERVERS, relay] : [...STUN_SERVERS]
}

/** empty when there's nothing to say */
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
