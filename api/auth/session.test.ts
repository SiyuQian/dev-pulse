import type { ApiRequest, ApiResponse } from '../_lib/http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sealSession, SESSION_COOKIE } from '../_lib/session'
import handler from './session'

const secret = 'test-secret-that-is-long-enough-for-session-encryption'

interface Capture {
  statusCode?: number
  body?: unknown
  headers: Record<string, string | string[]>
}

function response(): { capture: Capture; res: ApiResponse } {
  const capture: Capture = { headers: {} }
  const res = {
    setHeader(name: string, value: string | string[]) {
      capture.headers[name] = value
    },
    status(statusCode: number) {
      capture.statusCode = statusCode
      return res
    },
    json(body: unknown) {
      capture.body = body
    },
  } as ApiResponse
  return { capture, res }
}

function request(sealed: string | null): ApiRequest {
  return {
    method: 'GET',
    headers: sealed ? { cookie: `${SESSION_COOKIE}=${sealed}` } : {},
    query: {},
  } as unknown as ApiRequest
}

beforeEach(() => {
  process.env.SESSION_SECRET = secret
  process.env.ALLOWED_GITHUB_USERS = 'SiyuQian'
})

afterEach(() => {
  delete process.env.SESSION_SECRET
  delete process.env.ALLOWED_GITHUB_USERS
})

describe('session endpoint', () => {
  it('returns the login with private, no-store for a valid session', () => {
    const sealed = sealSession({ login: 'SiyuQian', token: 'oauth-token' }, secret)
    const { capture, res } = response()
    handler(request(sealed), res)

    expect(capture.statusCode).toBe(200)
    expect(capture.body).toEqual({ authenticated: true, login: 'SiyuQian' })
    expect(capture.headers['Cache-Control']).toBe('private, no-store')
  })

  it('returns 401 without a session cookie', () => {
    const { capture, res } = response()
    handler(request(null), res)
    expect(capture.statusCode).toBe(401)
    expect(capture.body).toEqual({ authenticated: false })
  })

  it('returns 401 for an expired sealed session', () => {
    const sealed = sealSession(
      { login: 'SiyuQian', token: 'oauth-token' },
      secret,
      Date.now() - 8 * 24 * 3600 * 1000,
    )
    const { capture, res } = response()
    handler(request(sealed), res)
    expect(capture.statusCode).toBe(401)
  })

  it('returns 401 once the login leaves ALLOWED_GITHUB_USERS', () => {
    process.env.ALLOWED_GITHUB_USERS = 'someone-else'
    const sealed = sealSession({ login: 'SiyuQian', token: 'oauth-token' }, secret)
    const { capture, res } = response()
    handler(request(sealed), res)
    expect(capture.statusCode).toBe(401)
  })
})
