/**
 * The public relay two peers use to find each other.
 *
 * Only offers and answers pass through it, encrypted with a key derived from
 * the pairing code, and the topic name is a hash rather than the code itself.
 * Nothing about a board reaches it.
 *
 * Named in one place because it appeared at nine call sites across two
 * coordinators. The content security policy in index.html is filled in from it
 * when the renderer is built, so connect-src always names the same host.
 */

export const SIGNALING_HOST = 'https://ntfy.sh'

/** The stream a peer listens on for messages in its room. */
export function signalingStreamUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}/sse`
}

/** The endpoint a peer publishes to. */
export function signalingPublishUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}`
}
