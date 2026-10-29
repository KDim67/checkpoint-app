/** a long list draws the rows near its view and holds the room of the rest, so thousands of rows aren't all built at once */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** about a screen above and below the list's view, so a row is drawn before it scrolls in */
const NEAR = '800px 0px'

export interface NearWatcher {
  /** calls onNear once, when el comes near the list's view; returns the way to stop watching */
  watch: (el: Element, onNear: () => void) => () => void
  /** the list's scroller, once it exists, and null when it goes */
  setRoot: (root: HTMLElement | null) => void
}

/** without an observer, as in a test's DOM, nothing would ever say a row came near, so every row draws */
export const canWaitToDraw = (): boolean => typeof IntersectionObserver !== 'undefined'

/** one observer for a whole list; rows that ask before the scroller exists are watched once it does */
export function createNearWatcher(): NearWatcher {
  const waiting = new Map<Element, () => void>()
  let observer: IntersectionObserver | null = null

  const onEntries = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const onNear = waiting.get(entry.target)
      if (!onNear) continue
      waiting.delete(entry.target)
      observer?.unobserve(entry.target)
      onNear()
    }
  }

  return {
    watch(el, onNear) {
      waiting.set(el, onNear)
      observer?.observe(el)
      return () => {
        waiting.delete(el)
        observer?.unobserve(el)
      }
    },
    setRoot(root) {
      observer?.disconnect()
      observer = root && canWaitToDraw() ? new IntersectionObserver(onEntries, { root, rootMargin: NEAR }) : null
      if (observer) for (const el of waiting.keys()) observer.observe(el)
    }
  }
}

export interface HeightMemory {
  remember: (id: string, px: number) => void
  /** its own height once it has been drawn, otherwise the rows drawn so far on average */
  held: (id: string) => number
}

/** one per kind of row, so a card's height is never a note's guess */
export function createHeightMemory(firstGuessPx: number): HeightMemory {
  const heights = new Map<string, number>()
  let total = 0
  let count = 0
  return {
    remember(id, px) {
      if (px <= 0) return
      const before = heights.get(id)
      if (before !== undefined) {
        total -= before
        count--
      }
      heights.set(id, px)
      total += px
      count++
    },
    held: id => heights.get(id) ?? (count > 0 ? Math.round(total / count) : firstGuessPx)
  }
}

interface DrawWhenNear {
  drawn: boolean
  /** the row's outer element, watched while it's held */
  ref: React.MutableRefObject<HTMLElement | null>
  /** the room to hold while it isn't drawn */
  heldPx: number
  /** for a held row the keyboard reached: draw it and move the focus to focusSelector inside it */
  drawForFocus: () => void
}

/** one row's part: drawn at once when eager or outside a watched list, otherwise once it comes near */
export function useDrawWhenNear(watcher: NearWatcher | null, heights: HeightMemory, id: string, eager: boolean, focusSelector?: string): DrawWhenNear {
  const [drawn, setDrawn] = useState(() => eager || !watcher || !canWaitToDraw())
  const ref = useRef<HTMLElement | null>(null)
  const focusWhenDrawn = useRef(false)

  useEffect(() => {
    if (drawn || !watcher || !ref.current) return
    return watcher.watch(ref.current, () => setDrawn(true))
  }, [drawn, watcher])

  // after paint, so the read costs no extra layout; the room held for this row next time
  useEffect(() => {
    if (drawn && ref.current) heights.remember(id, ref.current.offsetHeight)
  }, [drawn, heights, id])

  useLayoutEffect(() => {
    if (!drawn || !focusWhenDrawn.current) return
    focusWhenDrawn.current = false
    if (focusSelector) ref.current?.querySelector<HTMLElement>(focusSelector)?.focus()
  }, [drawn, focusSelector])

  const drawForFocus = useCallback(() => {
    focusWhenDrawn.current = true
    setDrawn(true)
  }, [])

  return { drawn, ref, heldPx: heights.held(id), drawForFocus }
}
