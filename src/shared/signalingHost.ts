/** only CPace shares and sealed offers and answers pass through; one name since index.html's CSP is filled from it */

export const SIGNALING_HOST = 'https://ntfy.sh'

export function signalingStreamUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}/sse`
}

/** uncached and kept off push, so a message reaches only who is listening now; as query parameters, which need no preflight */
export function signalingPublishUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}?cache=no&firebase=no`
}
