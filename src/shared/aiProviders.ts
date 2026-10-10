/** an ai connection as the screen sees it; main keeps the key and only says whether there is one */
export interface AiProviderView {
  id: string
  name: string
  baseURL: string
  model: string
  hasKey: boolean
}

export interface AiProviderSet {
  providers: AiProviderView[]
  activeId: string
}

/** what the screen sends back; a key never travels with it, it has its own call */
export type AiProviderInput = Omit<AiProviderView, 'hasKey'>

/** includes LAN ranges and *.local so a networked ollama still counts as local */
export function isLocalUrl(url: string): boolean {
  if (!url) return true
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\b192\.168\.|\b10\.\d{1,3}\.|\b172\.(1[6-9]|2\d|3[01])\.|\.local(?::\d+)?(\/|$)/i.test(url)
}

/** the site a key is sent to; a key only ever goes back to the one it was saved for */
export function originOf(url: string): string {
  const trimmed = url.trim()
  try {
    return new URL(trimmed).origin.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}
