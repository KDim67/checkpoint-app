/** the parts of the open section, read off the page so a part that isn't drawn never gets a link */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { light } from '../../lib/settingsReveal'

export interface SettingsPart {
  label: string
  el: HTMLElement
}

/** room between the pinned header and a part scrolled up to it */
const PART_GAP = 12
/** within this of the end counts as scrolled to the end */
const END_SLACK = 2

/** a part holding other parts is only their frame */
export function partsIn(root: Element): SettingsPart[] {
  const marked = Array.from(root.querySelectorAll<HTMLElement>('[data-settings-part]'))
  return marked
    .filter(el => !marked.some(other => other !== el && el.contains(other)))
    .map(el => ({ label: el.dataset.settingsPart ?? '', el }))
}

/** the last part whose top has reached the line, the first of any side by side, and the last of all at the end */
export function currentPart(tops: number[], line: number, atEnd: boolean): number {
  if (atEnd) return tops.length - 1
  let at = 0
  tops.forEach((top, index) => {
    if (top <= line && top > tops[at]) at = index
  })
  return at
}

/** one empty list, so a section with none never looks like a change */
const NO_PARTS: SettingsPart[] = []

const sameParts = (a: SettingsPart[], b: SettingsPart[]): boolean =>
  a.length === b.length && a.every((part, i) => part.el === b[i].el && part.label === b[i].label)

export function useSettingsParts(scroller: RefObject<HTMLElement>, head: RefObject<HTMLElement>, section: string): {
  parts: SettingsPart[]
  current: number
  jump: (index: number) => void
} {
  // tagged with their section, so a newly opened one never shows the last one's parts for a frame
  const [found, setFound] = useState<{ section: string; parts: SettingsPart[] }>({ section, parts: NO_PARTS })
  const parts = found.section === section ? found.parts : NO_PARTS
  const [current, setCurrent] = useState(0)
  // a clicked link stays lit until you scroll yourself, even where the page can't bring it to the top
  const pinned = useRef<number | null>(null)

  useLayoutEffect(() => {
    pinned.current = null
    setCurrent(0)
  }, [section])

  // sections load their settings after they open, so the parts are read again as the page fills in
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    let frame = 0
    const read = (): void => {
      frame = 0
      const next = partsIn(root)
      setFound(previous => (previous.section === section && sameParts(previous.parts, next) ? previous : { section, parts: next }))
    }
    read()
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(read)
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [scroller, section])

  const line = useCallback((): number => {
    const root = scroller.current
    return (root?.getBoundingClientRect().top ?? 0) + (head.current?.offsetHeight ?? 0) + PART_GAP
  }, [scroller, head])

  useEffect(() => {
    const root = scroller.current
    if (!root || parts.length < 2) return
    let frame = 0
    const spy = (): void => {
      frame = 0
      if (pinned.current !== null) return
      const atEnd = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - END_SLACK
      setCurrent(currentPart(parts.map(part => part.el.getBoundingClientRect().top), line() + 1, atEnd))
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(spy)
    }
    const release = (): void => { pinned.current = null }
    root.addEventListener('scroll', onScroll, { passive: true })
    for (const kind of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) root.addEventListener(kind, release, { passive: true })
    spy()
    return () => {
      root.removeEventListener('scroll', onScroll)
      for (const kind of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) root.removeEventListener(kind, release)
      cancelAnimationFrame(frame)
    }
  }, [scroller, parts, line])

  const jump = useCallback((index: number) => {
    const root = scroller.current
    const part = parts[index]
    if (!root || !part) return
    pinned.current = index
    setCurrent(index)
    // the scroller's own smooth scrolling, which reduced motion turns off
    root.scrollTo({ top: root.scrollTop + part.el.getBoundingClientRect().top - line() })
    if (part.el.tabIndex < 0 && !part.el.hasAttribute('tabindex')) part.el.tabIndex = -1
    part.el.focus({ preventScroll: true })
    light(part.el)
  }, [scroller, parts, line])

  return { parts, current, jump }
}
