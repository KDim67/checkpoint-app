/** a picture arrives the shape it is, and several arrive side by side instead of in one pile */

/** the longest side a dropped picture takes, about the old fixed box */
export const IMAGE_LONGEST_SIDE = 320

/** the item floors, so a tiny icon is still something to click */
const MIN_WIDTH = 40
const MIN_HEIGHT = 32

/** the picture's own proportions at a size that suits the wall; small ones keep their size */
export function fitImageBox(
  natural: { width: number; height: number } | null,
  longest = IMAGE_LONGEST_SIDE
): { width: number; height: number } | null {
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) return null
  const scale = Math.min(1, longest / Math.max(natural.width, natural.height))
  return {
    width: Math.max(MIN_WIDTH, Math.round(natural.width * scale)),
    height: Math.max(MIN_HEIGHT, Math.round(natural.height * scale))
  }
}

/** centres for boxes laid out in a row around a point, a gap between each */
export function rowCentres(
  sizes: { width: number; height: number }[],
  at: { x: number; y: number },
  gap = 24
): { x: number; y: number }[] {
  const total = sizes.reduce((sum, s) => sum + s.width, 0) + gap * Math.max(0, sizes.length - 1)
  let left = at.x - total / 2
  return sizes.map(size => {
    const centre = { x: left + size.width / 2, y: at.y }
    left += size.width + gap
    return centre
  })
}
