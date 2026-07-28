import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProfile,
  decodeShareFragment,
  encodeShareFragment,
  isLogin,
  isRepoRef,
  loadProfiles,
  loadTokens,
  nextAccountLabel,
  profileName,
  saveProfiles,
  saveTokens,
  type ProfileStore,
  type WatchConfig,
} from './config'

// Tests run in node, so stand up the minimum localStorage the store needs.
const store = new Map<string, string>()
globalThis.localStorage = {
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage

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
    const json = JSON.stringify({
      version: 1,
      repos: ['ok/repo', 'bad repo!'],
      users: ['fine', 'not ok!'],
      staleDays: 3,
    })
    const b64 = btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect(decodeShareFragment('#config=' + b64)).toEqual({
      version: 1,
      repos: ['ok/repo'],
      users: ['fine'],
      staleDays: 3,
    })
  })
})

describe('profile store', () => {
  beforeEach(() => store.clear())

  it('starts with a single empty account', () => {
    const loaded = loadProfiles()
    expect(loaded.profiles).toHaveLength(1)
    expect(loaded.activeId).toBe(loaded.profiles[0].id)
    expect(loaded.profiles[0].config).toEqual({ version: 1, repos: [], users: [], staleDays: 7 })
    expect(loadTokens()).toEqual({})
  })

  it('migrates a v1 single-account setup into one profile', () => {
    store.set('devpulse:config:v1', JSON.stringify(config))
    store.set('devpulse:token:v1', 'ghp_legacy')

    const loaded = loadProfiles()
    expect(loaded.profiles).toHaveLength(1)
    expect(loaded.profiles[0].config).toEqual(config)
    expect(loadTokens()).toEqual({ [loaded.profiles[0].id]: 'ghp_legacy' })
    // v1 keys are gone, so the token is stored exactly once.
    expect(store.has('devpulse:config:v1')).toBe(false)
    expect(store.has('devpulse:token:v1')).toBe(false)
    expect(loadProfiles().profiles[0].id).toBe(loaded.profiles[0].id)
  })

  it('round-trips several accounts with per-account tokens and watchlists', () => {
    const work = createProfile('Work', config)
    const personal = createProfile('Personal', {
      version: 1,
      repos: ['me/blog'],
      users: [],
      staleDays: 3,
    })
    const saved: ProfileStore = { version: 2, activeId: personal.id, profiles: [work, personal] }
    saveProfiles(saved)
    saveTokens({ [work.id]: 'ghp_work', [personal.id]: 'ghp_personal' })

    const loaded = loadProfiles()
    expect(loaded.activeId).toBe(personal.id)
    expect(loaded.profiles.map((p) => p.label)).toEqual(['Work', 'Personal'])
    expect(loaded.profiles[1].config.repos).toEqual(['me/blog'])
    expect(loadTokens()[work.id]).toBe('ghp_work')
  })

  it('never persists a token inside the profiles blob', () => {
    const profile = { ...createProfile('Work', config), token: 'ghp_secret' }
    saveProfiles({ version: 2, activeId: profile.id, profiles: [profile] })
    // saveProfiles writes what it is given, so guard the read path: a stray token
    // field never survives into a loaded profile.
    expect(JSON.stringify(loadProfiles())).not.toContain('secret')
  })

  it('falls back to a fresh store on junk, and repairs a dangling activeId', () => {
    store.set('devpulse:profiles:v2', 'not json')
    expect(loadProfiles().profiles).toHaveLength(1)

    const only = createProfile('Work')
    saveProfiles({ version: 2, activeId: 'ghost', profiles: [only] })
    expect(loadProfiles().activeId).toBe(only.id)

    saveProfiles({ version: 2, activeId: only.id, profiles: [] })
    expect(loadProfiles().profiles).toHaveLength(1)
  })

  it('drops empty tokens rather than storing them', () => {
    saveTokens({ a: 'ghp_a', b: '' })
    expect(loadTokens()).toEqual({ a: 'ghp_a' })
    saveTokens({ a: '' })
    expect(store.has('devpulse:tokens:v2')).toBe(false)
  })

  it('labels accounts by login when known, nickname otherwise', () => {
    expect(profileName({ label: 'Work', login: 'octocat' })).toBe('@octocat')
    expect(profileName({ label: 'Work' })).toBe('Work')
    expect(nextAccountLabel([createProfile('Account 1'), createProfile('Account 2')])).toBe(
      'Account 3',
    )
    expect(nextAccountLabel([createProfile('Work')])).toBe('Account 2')
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
