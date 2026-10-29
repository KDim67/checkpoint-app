/** the Wall's handwriting and rounded faces, fetched when the Wall opens; in the page's head they held up every launch's first paint on the network */

export const WALL_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Nunito:wght@600;700&display=swap'

/** once per window; offline, the faces fall back to the system's own handwriting and rounded fonts */
export function loadWallFonts(): void {
  if (document.querySelector('link[data-wall-fonts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = WALL_FONTS_HREF
  link.dataset.wallFonts = ''
  document.head.appendChild(link)
}
