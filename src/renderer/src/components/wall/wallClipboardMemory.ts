/** outlives a wall switch and a trip to another view; a menu click raises no copy event, so its copies live here */

import type { WallClip, WallStyle } from '../../../../shared/wallClipboard'

let lastClip: { clip: WallClip; text: string } | null = null
let lastStyle: WallStyle | null = null

export function rememberClip(clip: WallClip, text: string): void {
  lastClip = { clip, text }
}

/** given the clipboard's text, only while the clipboard still holds what the clip was copied as */
export function rememberedClip(clipboardText?: string): WallClip | null {
  if (!lastClip) return null
  return clipboardText === undefined || clipboardText === lastClip.text ? lastClip.clip : null
}

export function rememberStyle(style: WallStyle): void {
  lastStyle = style
}

export const rememberedStyle = (): WallStyle | null => lastStyle
