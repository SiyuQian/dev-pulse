import type { ApiRequest, ApiResponse } from '../_lib/http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OAUTH_STATE_COOKIE } from '../_lib/session'
import handler from './login'

interface Capture {
  statusCode?: number
  body?: unknown
  headers: Record<string, string | string[]>
  redirect?: { statusCode: number; url: string }
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
    redirect(statusCode: number, url: string) {
      capture.statusCode = statusCode
      capture.redirect = { statusCode, url }
    },
  } as ApiResponse
  return { capture, res }
}

function request(method = 'GET'): ApiRequest {
  return { method, headers: {}, query: {} } as unknown as ApiRequest
}

beforeEach(() => {
  process.env.APP_URL = 'https://dev-pulse.siyu.co.nz'
  process.env.GITHUB_CLIENT_ID = 'client-id'
})

afterEach(() => {
  delete process.env.APP_URL
  delete process.env.GITHUB_CLIENT_ID
})

describe('GitHub OAuth login', () => {
  it('returns 405 for non-GET requests', () => {
    const { capture, res } = response()
    handler(request('POST'), res)
    expect(capture.statusCode).toBe(405)
    expect(capture.headers.Allow).toBe('GET')
  })

  it('returns 500 when OAuth is not configured', () => {
    delete process.env.GITHUB_CLIENT_ID
    const { capture, res } = response()
    handler(request(), res)
    expect(capture.statusCode).toBe(500)
  })

  it('issues a fresh state cookie scoped to /api/auth and redirects to GitHub authorize', () => {
    const { capture, res } = response()
    handler(request(), res)

    const cookie = capture.headers['Set-Cookie'] as string
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE}=`)
    expect(cookie).toContain('Path=/api/auth')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')

    const state = /devpulse_oauth_state=([^;]+)/.exec(cookie)![1]
    const url = new URL(capture.redirect!.url)
    expect(url.origin).toBe('https://github.com')
    expect(url.searchParams.get('state')).toBe(decodeURIComponent(state))
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://dev-pulse.siyu.co.nz/api/auth/callback',
    )

    // A second login must never reuse the nonce.
    const second = response()
    handler(request(), second.res)
    expect(second.capture.headers['Set-Cookie']).not.toBe(cookie)
  })
})
