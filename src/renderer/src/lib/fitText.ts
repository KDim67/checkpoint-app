/** words sized to their box, the same way wherever they are read or written */

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
