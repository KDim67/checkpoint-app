import { describe, it, expect, vi } from 'vitest'
import { isPublicAddress, isPublicHost } from '../src/main/publicAddress'

describe('isPublicAddress', () => {
  it('refuses this machine, private networks and the cloud metadata address', () => {
    for (const address of [
      '127.0.0.1', '127.8.8.8', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255'
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('refuses the IPv6 equivalents, including IPv4 wrapped in IPv6', () => {
    for (const address of [
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.1.1', '64:ff9b::7f00:1', '2002:7f00:1::1'
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('allows ordinary internet addresses', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('refuses anything that is not an address', () => {
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })
})

describe('isPublicHost', () => {
  const resolver = (records: Record<string, string[]>) => vi.fn(async (host: string) => {
    const addresses = records[host]
    if (!addresses) throw new Error('ENOTFOUND')
    return addresses.map(address => ({ address }))
  })

  it('judges an address given as the host without asking DNS', async () => {
    const resolve = resolver({})
    expect(await isPublicHost('93.184.216.34', resolve)).toBe(true)
    expect(await isPublicHost('[::1]', resolve)).toBe(false)
    // the URL parser has already turned 2130706433 into 127.0.0.1
    expect(await isPublicHost(new URL('http://2130706433/').hostname, resolve)).toBe(false)
    expect(await isPublicHost(new URL('http://[::ffff:127.0.0.1]/').hostname, resolve)).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses localhost names without asking DNS', async () => {
    const resolve = resolver({})
    expect(await isPublicHost('localhost', resolve)).toBe(false)
    expect(await isPublicHost('LOCALHOST.', resolve)).toBe(false)
    expect(await isPublicHost('api.localhost', resolve)).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses a name when any address it resolves to is private', async () => {
    const resolve = resolver({ 'example.com': ['93.184.216.34'], 'sneaky.example': ['93.184.216.34', '10.0.0.5'] })
    expect(await isPublicHost('example.com', resolve)).toBe(true)
    expect(await isPublicHost('sneaky.example', resolve)).toBe(false)
  })

  it('refuses a name that does not resolve', async () => {
    expect(await isPublicHost('nowhere.invalid', resolver({}))).toBe(false)
  })
})
