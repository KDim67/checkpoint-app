/** naming Linear issues the same way on every computer */

/** where someone makes a personal API key: Settings, Security & access */
export const LINEAR_KEY_PAGE = 'https://linear.app/settings/account/security'

// Linear's ids are uuids; letters, digits and dashes cover them without letting anything leave a query
const ID = /^[A-Za-z0-9-]{1,64}$/

export const isLinearId = (text: string): boolean => ID.test(text)

/** Urgent and High are both high here; Linear's 0 is no priority */
export function linearPriority(raw: unknown): 0 | 1 | 2 | 3 {
  switch (raw) {
    case 1:
    case 2:
      return 3
    case 3:
      return 2
    case 4:
      return 1
    default:
      return 0
  }
}
