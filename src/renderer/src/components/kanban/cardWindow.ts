/** a long column draws the cards near its view and holds their room for the rest, so a board's whole history isn't built at once */

import { createContext } from 'react'
import { createHeightMemory, type NearWatcher } from '../../lib/drawWhenNear'

export { createNearWatcher as createCardWindow } from '../../lib/drawWhenNear'

/** each column's first cards draw straight away, so the first frame shows cards rather than boxes */
export const EAGER_CARDS = 20

export const CardWindowContext = createContext<NearWatcher | null>(null)

export const cardHeights = createHeightMemory(76)
