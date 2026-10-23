/** finding a setting on screen by its words, then bringing it into view, focused and lit for a moment */

import { SETTING_FOUND_MS } from './timings'

const CONTROL = 'input:not([type="hidden"]), select, textarea, button, a[href], [role="switch"], [tabindex="0"]'
const HEADING = 'h1, h2, h3, h4, h5, h6'
/** a label is never more than a few wrappers away from its control; further up is the next setting's */
const ROW_DEPTH = 3
/** a field with its browse and reset buttons */
const ROW_CONTROLS = 3
const UNDER_DEPTH = 4

export interface FoundSetting {
  /** what gets lit and scrolled to */
  target: HTMLElement
  /** what gets focus, when the setting has one */
  control: HTMLElement | null
}

const plain = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** the name alone, or with a count or value after it, like "(3)" or ", 0.7" */
function says(el: Element, name: string): boolean {
  // a list's choices and a box's typed text are values, not names
  if (el.closest('select, textarea, script, style')) return false
  const text = plain(el.textContent ?? '')
  return text.startsWith(name) && !/\p{L}/u.test(text.slice(name.length))
}

/** the deepest element saying it, so the label and not the card holding it */
function innermost(scope: Element, name: string): HTMLElement | null {
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
    if (says(el, name) && !Array.from(el.children).some(child => says(child, name))) return el
  }
  return null
}

/** a card's title stands for the whole card */
function partTitled(heading: HTMLElement): HTMLElement | null {
  const part = heading.closest<HTMLElement>('[data-settings-part]')
  return part && plain(part.dataset.settingsPart ?? '') === plain(heading.textContent ?? '') ? part : null
}

function placed(el: HTMLElement, name: string, scope: Element): FoundSetting {
  const own = el.closest<HTMLElement>('button, a[href]') ?? (el.matches(CONTROL) ? el : null)
  if (own) return { target: own, control: own }
  if (el.matches(HEADING)) return { target: partTitled(el) ?? el, control: null }
  let row = el
  for (let depth = 0; depth < ROW_DEPTH && row !== scope && row.parentElement; depth++) {
    row = row.parentElement
    const controls = Array.from(row.querySelectorAll<HTMLElement>(CONTROL))
    if (controls.length === 0) continue
    // more than one setting's worth is a group of settings, not this one's row
    if (controls.length > ROW_CONTROLS) break
    const labelled = el instanceof HTMLLabelElement && el.htmlFor ? document.getElementById(el.htmlFor) : null
    return { target: row, control: labelled ?? controls.find(c => plain(c.getAttribute('aria-label') ?? '') === name) ?? controls[0] }
  }
  return { target: el, control: null }
}

/** the smallest area around the heading that also holds the setting */
function around(root: Element, under: string, name: string): Element | null {
  let area: Element | null = innermost(root, plain(under))
  for (let depth = 0; area && depth < UNDER_DEPTH; depth++) {
    if (innermost(area, name)) return area
    area = area === root ? null : area.parentElement
  }
  return null
}

export function findSetting(root: Element, name: string, under?: string): FoundSetting | null {
  const wanted = plain(name)
  const scope = (under && around(root, under, wanted)) || root
  const text = innermost(scope, wanted)
  if (text) return placed(text, wanted, scope)
  // a control named only for screen readers
  const labelled = Array.from(scope.querySelectorAll<HTMLElement>('[aria-label]'))
    .find(el => plain(el.getAttribute('aria-label') ?? '') === wanted)
  return labelled ? { target: labelled, control: labelled } : null
}

/** lit long enough to spot, and seen even where nothing had to scroll */
export function light(target: HTMLElement): void {
  target.classList.add('settings-found')
  window.setTimeout(() => target.classList.remove('settings-found'), SETTING_FOUND_MS)
}

/** scrolled to the middle, focused for the keyboard, then lit */
export function showSetting({ target, control }: FoundSetting): void {
  target.scrollIntoView({ block: 'center' })
  const focusable = control ?? target
  if (!control && !target.matches(CONTROL)) target.tabIndex = -1
  focusable.focus({ preventScroll: true })
  light(target)
}

/** keeps looking while a section loads its settings, until the first sighting or the time runs out; returns a stop */
export function revealWhenShown(root: Element, name: string, under: string | undefined, waitMs: number): () => void {
  let frame = 0
  const look = (): void => {
    frame = 0
    const found = findSetting(root, name, under)
    if (!found) return
    stop()
    showSetting(found)
  }
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(look)
  })
  const timer = window.setTimeout(() => stop(), waitMs)
  function stop(): void {
    observer.disconnect()
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
  observer.observe(root, { childList: true, subtree: true })
  // the section may be drawn already, or about to be
  frame = requestAnimationFrame(look)
  return stop
}
