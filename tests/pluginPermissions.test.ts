import { describe, it, expect } from 'vitest'
import {
  grantCovers,
  normalizeHost,
  normalizeRequest,
  readGrants,
  renameGrantWorkspaces,
  sameRequest
} from '../src/shared/pluginPermissions'
import { grantOf } from './helpers/plugins'

describe('what a plugin asks for', () => {
  it('keeps the permissions Checkpoint offers and shows the rest as ignored', () => {
    expect(normalizeRequest(['Read', 'write', 'delete', 'read'], [])).toStrictEqual({
      permissions: ['read', 'write'], hosts: [], ignored: ['delete']
    })
  })

  it('treats listing hosts as asking for the network, and network alone as reaching nothing', () => {
    expect(normalizeRequest(['read'], ['Hooks.Slack.com.'])).toMatchObject({ permissions: ['read', 'network'], hosts: ['hooks.slack.com'] })
    expect(normalizeRequest(['network'], []).permissions).toStrictEqual([])
  })

  it('accepts only plain public host names', () => {
    for (const bad of ['localhost', '127.0.0.1', '*.example.com', 'example.com:8080', 'https://example.com', 'intranet', '[::1]']) {
      expect(normalizeHost(bad), bad).toBeNull()
    }
    expect(normalizeHost('api.example.co.uk')).toBe('api.example.co.uk')
  })
})

describe('whether an approval still covers a plugin', () => {
  const request = normalizeRequest(['read', 'notify'], ['a.example.com'])

  it('covers asking for the same or less', () => {
    expect(grantCovers(grantOf(['read', 'notify', 'network'], { hosts: ['a.example.com'] }), request)).toBe(true)
    expect(grantCovers(grantOf(['read', 'notify', 'network', 'write'], { hosts: ['a.example.com', 'b.example.com'] }), request)).toBe(true)
  })

  it('does not cover a new permission or a new host', () => {
    expect(grantCovers(grantOf(['read', 'network'], { hosts: ['a.example.com'] }), request)).toBe(false)
    expect(grantCovers(grantOf(['read', 'notify', 'network'], { hosts: ['b.example.com'] }), request)).toBe(false)
  })

  it('never covers anything for a plugin that was on before the sandbox', () => {
    expect(grantCovers(grantOf(['read', 'notify', 'network'], { hosts: ['a.example.com'], legacy: true }), request)).toBe(false)
  })

  it('compares what was shown with what is on disk regardless of order', () => {
    expect(sameRequest({ permissions: ['notify', 'read'], hosts: [] }, { permissions: ['read', 'notify'], hosts: [] })).toBe(true)
    expect(sameRequest({ permissions: ['read'], hosts: [] }, { permissions: ['read', 'notify'], hosts: [] })).toBe(false)
  })
})

describe('stored approvals', () => {
  it('read hand-edited or damaged JSON as no approval rather than a wider one', () => {
    expect(readGrants('nonsense')).toStrictEqual({})
    expect(readGrants({ 'a.js': { on: 'yes', permissions: ['read', 'root'], hosts: ['localhost', 'x.example.com'], workspaces: ['w', 'w', 3] } })).toStrictEqual({
      'a.js': { on: false, permissions: ['read'], hosts: ['x.example.com'], workspaces: ['w'], grantedAt: 0 }
    })
  })

  it('follow a workspace rename', () => {
    const grants = { 'a.js': grantOf(['read'], { workspaces: ['work', 'home'] }), 'b.js': grantOf(['read'], { workspaces: ['home'] }) }
    const renamed = renameGrantWorkspaces(grants, 'work', 'job')
    expect(renamed['a.js'].workspaces).toStrictEqual(['job', 'home'])
    expect(renamed['b.js']).toBe(grants['b.js'])
  })
})
