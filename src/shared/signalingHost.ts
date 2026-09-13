/** only encrypted offers and answers pass through; one name since index.html's CSP is filled from it */

export const SIGNALING_HOST = 'https://ntfy.sh'

export function signalingStreamUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}/sse`
}

export function signalingPublishUrl(room: string): string {
  return `${SIGNALING_HOST}/${room}`
}
