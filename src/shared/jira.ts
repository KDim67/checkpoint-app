/** naming Jira Cloud sites and issues the same way on every computer */

/** where someone makes an API token for their Atlassian account */
export const JIRA_KEY_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens'

const SITE_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net$/

/** acme, acme.atlassian.net or any address on it, as https://acme.atlassian.net; null for anything that isn't a Jira Cloud site */
export function normalizeJiraSite(input: string): string | null {
  let text = input.trim().toLowerCase()
  if (!text) return null
  if (!text.includes('://')) text = text.includes('.') ? `https://${text}` : `https://${text}.atlassian.net`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port || !SITE_HOST.test(url.hostname)) return null
  return `https://${url.hostname}`
}

/** an issue's or a project's id: digits that never change, unlike its key */
export const isJiraId = (text: string): boolean => /^\d{1,18}$/.test(text)

export const isJiraKey = (text: string): boolean => /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/.test(text)

export const jiraIssueUrl = (site: string, key: string): string => `${site}/browse/${key}`

/** a card's link opens only an issue page on a Jira Cloud site */
export const opensJira = (url: string): boolean => /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.atlassian\.net\/browse\/[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/.test(url)

/** Jira's default priority names; a scheme's own names come across as none */
export function jiraPriority(name: unknown): 0 | 1 | 2 | 3 {
  switch (typeof name === 'string' ? name.toLowerCase() : '') {
    case 'highest':
    case 'high':
      return 3
    case 'medium':
      return 2
    case 'low':
    case 'lowest':
      return 1
    default:
      return 0
  }
}
