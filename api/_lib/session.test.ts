import { describe, expect, it } from 'vitest'
import {
  cookie,
  cookiesAreSecure,
  isAllowedLogin,
  openSession,
  readCookie,
  sealSession,
} from './session'

const secret = 'test-secret-that-is-long-enough-for-session-encryption'

describe('session cookies', () => {
  it('round-trips an encrypted GitHub session', () => {
    const now = Date.parse('2026-08-24T00:00:00Z')
    const sealed = sealSession({ login: 'SiyuQian', token: 'github-oauth-token' }, secret, now)

    expect(sealed).not.toContain('github-oauth-token')
    expect(openSession(sealed, secret, now)).toEqual({
      login: 'SiyuQian',
      token: 'github-oauth-token',
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    })
  })

  it('rejects a session after its server-enforced expiry', () => {
    const now = Date.parse('2026-08-24T00:00:00Z')
    const sealed = sealSession({ login: 'SiyuQian', token: 'github-oauth-token' }, secret, now)

    expect(openSession(sealed, secret, now + 7 * 24 * 60 * 60 * 1000)).toBeNull()
  })

  it('rejects a tampered session', () => {
    const sealed = sealSession({ login: 'SiyuQian', token: 'github-oauth-token' }, secret)
    const midpoint = Math.floor(sealed.length / 2)
    const replacement = sealed[midpoint] === 'a' ? 'b' : 'a'
    const tampered = `${sealed.slice(0, midpoint)}${replacement}${sealed.slice(midpoint + 1)}`

    expect(openSession(tampered, secret)).toBeNull()
  })
})

describe('cookie security', () => {
  it('keeps Secure in production and can omit it for localhost development', () => {
    expect(cookiesAreSecure('https://dev-pulse.siyu.co.nz')).toBe(true)
    expect(cookiesAreSecure('http://localhost:3000')).toBe(false)
    expect(() => cookiesAreSecure('http://dev-pulse.example.com')).toThrow('APP_URL must use HTTPS')
    expect(cookie('session', 'value', { maxAge: 60 })).toContain('Secure')
    expect(cookie('session', 'value', { maxAge: 60, secure: false })).not.toContain('Secure')
  })

  it('treats malformed percent encoding as an invalid cookie', () => {
    expect(readCookie('devpulse_session=%E0%A4%A', 'devpulse_session')).toBeNull()
  })
})

describe('GitHub access allowlist', () => {
  it('matches comma-separated logins case-insensitively', () => {
    expect(isAllowedLogin('siyuqian', 'SiyuQian, SiyuAI')).toBe(true)
    expect(isAllowedLogin('SIYUAI', 'SiyuQian, SiyuAI')).toBe(true)
    expect(isAllowedLogin('someone-else', 'SiyuQian, SiyuAI')).toBe(false)
  })

  it('fails closed when no allowlist is configured', () => {
    expect(isAllowedLogin('SiyuQian', '')).toBe(false)
  })
})
