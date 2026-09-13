/** a link preview goes where a page tells it; nothing on this machine or its network is a page's to reach */

import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const blocked = new BlockList()

// this network, private, carrier NAT, loopback, link-local and cloud metadata, reserved, documentation, multicast
const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]

// unspecified, loopback and IPv4-compatible; NAT64 and 6to4 wrap IPv4; discard, documentation, unique local, link-local, multicast
const IPV6_BLOCKED: [string, number][] = [
  ['::', 96], ['64:ff9b::', 96], ['2002::', 16], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]

for (const [network, prefix] of IPV4_BLOCKED) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of IPV6_BLOCKED) blocked.addSubnet(network, prefix, 'ipv6')

/** URL writes IPv6 one canonical way, so the mapped form reads with a pattern */
function mappedIpv4(address: string): string | null {
  let canonical: string
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (!m) return null
  const high = parseInt(m[1], 16)
  const low = parseInt(m[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family !== 6) return false
  // judged as the IPv4 it carries, or ::ffff:127.0.0.1 walks past the IPv4 rules
  const mapped = mappedIpv4(address)
  return mapped ? isPublicAddress(mapped) : !blocked.check(address, 'ipv6')
}

type Resolve = (host: string) => Promise<{ address: string }[]>

const resolveAll: Resolve = host => lookup(host, { all: true, verbatim: true })

/** a name resolving anywhere private is refused; fetch resolves again, so a rebinding DNS server still has a narrow window */
export async function isPublicHost(hostname: string, resolve: Resolve = resolveAll): Promise<boolean> {
  // URL keeps IPv6 hosts in brackets, and a trailing dot is the same name
  const host = hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '').toLowerCase()
  if (isIP(host)) return isPublicAddress(host)
  // local whatever DNS says
  if (host === 'localhost' || host.endsWith('.localhost')) return false

  try {
    const records = await resolve(host)
    // one private answer is enough, the connection could land on it
    return records.length > 0 && records.every(r => isPublicAddress(r.address))
  } catch {
    return false
  }
}
