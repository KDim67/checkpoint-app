import { describe, expect, it } from 'vitest'
import { isRepoName, issueCardId, issueRemoteId, parseGitHubRemote } from '../src/shared/github'
import { linkOf } from '../src/shared/connections'

describe('a repository from a folder\'s remote', () => {
  it.each([
    ['https://github.com/octo/hello-world.git', 'octo/hello-world'],
    ['https://github.com/octo/hello-world', 'octo/hello-world'],
    ['https://github.com/octo/hello.world/', 'octo/hello.world'],
    ['git@github.com:octo/hello-world.git', 'octo/hello-world'],
    ['ssh://git@github.com/octo/hello-world.git', 'octo/hello-world'],
    ['HTTPS://GitHub.com/Octo/Repo', 'Octo/Repo']
  ])('reads %s', (remote, repo) => {
    expect(parseGitHubRemote(remote)).toBe(repo)
  })

  it.each([
    'https://gitlab.com/octo/repo.git',
    'git@bitbucket.org:octo/repo.git',
    'https://github.com/octo',
    'https://github.com.evil.example/octo/repo',
    'not a url'
  ])('ignores %s', remote => {
    expect(parseGitHubRemote(remote)).toBeNull()
  })
})

describe('naming issues', () => {
  it('accepts only owner/repo', () => {
    expect(isRepoName('octo/hello-world')).toBe(true)
    expect(isRepoName('octo/hello.world_2')).toBe(true)
    expect(isRepoName('octo')).toBe(false)
    expect(isRepoName('octo/repo/extra')).toBe(false)
    expect(isRepoName('../etc/passwd')).toBe(false)
  })

  it('gives every computer the same card id for the same issue, and different issues different ones', () => {
    expect(issueRemoteId('octo/repo', 12)).toBe('octo/repo#12')
    expect(issueCardId('octo/repo', 12)).toBe(issueCardId('octo/repo', 12))
    expect(issueCardId('octo/repo', 12)).not.toBe(issueCardId('octo/repo', 13))
    expect(issueCardId('octo/repo', 12)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('a card\'s link', () => {
  it('reads a well-formed one and nothing else', () => {
    const link = { service: 'github', id: 'octo/repo#12', url: 'https://github.com/octo/repo/issues/12', state: 'open', labels: ['bug'] }
    expect(linkOf(JSON.stringify({ checklist: [], link }))).toStrictEqual(link)
    expect(linkOf(JSON.stringify({ link: { ...link, problem: 'Waiting to close' } }))?.problem).toBe('Waiting to close')
    expect(linkOf('{}')).toBeNull()
    expect(linkOf('not json')).toBeNull()
    expect(linkOf(JSON.stringify({ link: { ...link, state: 'merged' } }))).toBeNull()
    expect(linkOf(JSON.stringify({ link: { ...link, url: 'javascript:alert(1)' } }))).toBeNull()
  })
})
