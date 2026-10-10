/** jsdom measures no layout, and the Wall's text editor asks a text range where it is to scroll the caret into view */

const nowhere = (): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect

export function standInForRangeLayout(): void {
  if (typeof Range === 'undefined') return
  Range.prototype.getBoundingClientRect = nowhere
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
}
