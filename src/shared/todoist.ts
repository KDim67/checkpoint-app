/** naming Todoist tasks the same way on every computer */

/** where someone copies their API token: Settings, Integrations, Developer */
export const TODOIST_KEY_PAGE = 'https://app.todoist.com/app/settings/integrations/developer'

// letters, digits, _ and -: old numeric ids and the newer ones both fit, and nothing that could leave the path
const ID = /^[A-Za-z0-9_-]{1,64}$/

export const isTodoistId = (text: string): boolean => ID.test(text)

export const todoistTaskUrl = (id: string): string => `https://app.todoist.com/app/task/${id}`
