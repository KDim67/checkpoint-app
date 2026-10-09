/** api.fetch: only the hosts you approved, https only, every redirect hop checked, nothing local or private */

import { guardedFetch, readCapped } from '../guardedFetch'
import { isPublicHost } from '../publicAddress'
import { normalizeHost } from '../../shared/pluginPermissions'
import { PluginCallError, type FetchInit, type FetchResult } from './bridge'

export const FETCH_TIMEOUT_MS = 15_000
export const FETCH_RESPONSE_BYTES = 1024 * 1024

export interface PluginFetchDeps {
  fetch: typeof fetch
  isPublicHost: (hostname: string) => Promise<boolean>
}

const real: PluginFetchDeps = { fetch: (input, init) => fetch(input, init), isPublicHost: hostname => isPublicHost(hostname) }

export async function pluginFetch(url: URL, init: FetchInit, hosts: string[], deps: PluginFetchDeps = real): Promise<FetchResult> {
  const allowed = async (hop: URL): Promise<boolean> => {
    const host = normalizeHost(hop.hostname)
    return hop.protocol === 'https:' && host !== null && hosts.includes(host) && (await deps.isPublicHost(hop.hostname))
  }

  let fetched: Awaited<ReturnType<typeof guardedFetch>>
  try {
    fetched = await guardedFetch(
      url.href,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: init.headers, method: init.method, body: init.body },
      { fetch: deps.fetch, isAllowed: allowed },
      'plugin'
    )
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? `no answer within ${FETCH_TIMEOUT_MS / 1000} seconds`
      : err instanceof Error ? err.message : String(err)
    throw new PluginCallError(`api.fetch: couldn't reach ${url.hostname}: ${reason}.`)
  }
  if (!fetched) {
    throw new PluginCallError(`api.fetch: the request to ${url.hostname} was refused, because it led to an address or host the plugin isn't allowed to reach.`)
  }

  const { response, finalUrl } = fetched
  const bytes = await readCapped(response, FETCH_RESPONSE_BYTES + 1)
  if (bytes.byteLength > FETCH_RESPONSE_BYTES) {
    throw new PluginCallError(`api.fetch: the answer from ${url.hostname} is larger than ${FETCH_RESPONSE_BYTES / 1024 / 1024} MB.`)
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    text: new TextDecoder().decode(bytes),
    url: finalUrl
  }
}
