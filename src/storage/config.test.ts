import { describe, expect, it } from 'vitest'
import { decodeShareFragment, encodeShareFragment, isLogin, isRepoRef, type WatchConfig } from './config'

const config: WatchConfig = {
  version: 1,
  repos: ['vercel/next.js', 'facebook/react'],
  users: ['octocat'],
  staleDays: 5,
}

describe('share fragment', () => {
  it('round-trips a config', () => {
    const fragment = encodeShareFragment(config)
    expect(fragment.startsWith('#config=')).toBe(true)
    expect(decodeShareFragment(fragment)).toEqual(config)
  })

  it('never includes a token field', () => {
    const fragment = encodeShareFragment({ ...config, token: 'ghp_secret' } as WatchConfig)
    expect(fragment).not.toContain('secret')
    const decoded = decodeShareFragment(fragment)
    expect(decoded && 'token' in decoded).toBe(false)
  })

  it('rejects malformed fragments', () => {
    expect(decodeShareFragment('#config=!!!')).toBeNull()
    expect(decodeShareFragment('#/settings')).toBeNull()
    expect(decodeShareFragment('')).toBeNull()
    expect(decodeShareFragment('#config=' + btoa('{"version":99}'))).toBeNull()
  })

  it('filters invalid entries on decode', () => {
    const json = JSON.stringify({ version: 1, repos: ['ok/repo', 'bad repo!'], users: ['fine', 'not ok!'], staleDays: 3 })
    const b64 = btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect(decodeShareFragment('#config=' + b64)).toEqual({
      version: 1,
      repos: ['ok/repo'],
      users: ['fine'],
      staleDays: 3,
    })
  })
})

describe('validators', () => {
  it('validates repo refs', () => {
    expect(isRepoRef('owner/name')).toBe(true)
    expect(isRepoRef('owner/name.js')).toBe(true)
    expect(isRepoRef('owner')).toBe(false)
    expect(isRepoRef('owner/name/extra')).toBe(false)
    expect(isRepoRef('owner/na me')).toBe(false)
  })

  it('validates logins', () => {
    expect(isLogin('octocat')).toBe(true)
    expect(isLogin('a-b-1')).toBe(true)
    expect(isLogin('has space')).toBe(false)
    expect(isLogin('')).toBe(false)
  })
})
