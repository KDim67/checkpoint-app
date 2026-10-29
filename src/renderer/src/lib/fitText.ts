/** words sized to their box, the same way wherever they are read or written */

import { useSyncExternalStore } from 'react'

/**
 * sets the element's font size to the largest from base down to min where its words still fit,
 * and answers how many pixels taller the box would have to be to hold them at that size
 */
export function fitTextSize(el: HTMLElement, base: number, min: number): { size: number; over: number } {
  let size = base
  el.style.fontSize = `${size}px`
  // one measure for words that fit, which is most of them
  while (size > min && el.scrollHeight > el.clientHeight + 1) {
    size -= 1
    el.style.fontSize = `${size}px`
  }
  return { size, over: Math.max(0, el.scrollHeight - el.clientHeight) }
}

interface FitJob {
  el: HTMLElement
  base: number
  min: number
  done: (fit: { size: number; over: number }) => void
  cancelled: boolean
  /** the largest size known to fit, or the floor, and the largest that might */
  lo: number
  hi: number
}

const waiting: FitJob[] = []

const overflows = (el: HTMLElement): boolean => el.scrollHeight > el.clientHeight + 1

/** every box asked for in one render: all the sizes written, then all read, halving what's left each round */
function fitWaiting(): void {
  const jobs = waiting.splice(0).filter(job => !job.cancelled && job.el.isConnected)
  for (const job of jobs) job.el.style.fontSize = `${job.base}px`
  // most fit at their own size, which one layout settles for all of them
  let open = jobs.filter(job => job.base > job.min && overflows(job.el))
  for (const job of jobs) job.lo = job.hi = job.base
  for (const job of open) {
    job.lo = job.min
    job.hi = job.base - 1
  }
  open = open.filter(job => job.lo < job.hi)
  while (open.length > 0) {
    const tries = open.map(job => Math.ceil((job.lo + job.hi) / 2))
    open.forEach((job, i) => { job.el.style.fontSize = `${tries[i]}px` })
    open.forEach((job, i) => {
      if (overflows(job.el)) job.hi = tries[i] - 1
      else job.lo = tries[i]
    })
    open = open.filter(job => job.lo < job.hi)
  }
  for (const job of jobs) job.el.style.fontSize = `${job.lo}px`
  const overs = jobs.map(job => Math.max(0, job.el.scrollHeight - job.el.clientHeight))
  // after every read, so a box growing for its words can't make the next read lay out again
  jobs.forEach((job, i) => job.done({ size: job.lo, over: overs[i] }))
}

/** fitTextSize for a box drawn with many: all measured together before paint, since one at a time every read laid the whole wall out again */
export function fitTextSizeSoon(el: HTMLElement, base: number, min: number, done: (fit: { size: number; over: number }) => void): () => void {
  const job: FitJob = { el, base, min, done, cancelled: false, lo: base, hi: base }
  waiting.push(job)
  if (waiting.length === 1) queueMicrotask(fitWaiting)
  return () => { job.cancelled = true }
}

let fontLoads = 0
const fontListeners = new Set<() => void>()

function fontsLoaded(): void {
  fontLoads++
  for (const listener of fontListeners) listener()
}

/** one listener on the page's fonts however many boxes ask */
function subscribeToFonts(listener: () => void): () => void {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (fontListeners.size === 0) fonts?.addEventListener('loadingdone', fontsLoaded)
  fontListeners.add(listener)
  return () => {
    fontListeners.delete(listener)
    if (fontListeners.size === 0) fonts?.removeEventListener('loadingdone', fontsLoaded)
  }
}

/** counts finished font loads: words fitted in a stand-in face before theirs arrived are fitted again in it */
export function useFontLoads(): number {
  return useSyncExternalStore(subscribeToFonts, () => fontLoads, () => 0)
}
