import type { ApiRequest, ApiResponse } from '../_lib/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAUTH_STATE_COOKIE, sealSession, SESSION_COOKIE } from '../_lib/session'
import handler from './logout'

const secret = 'test-secret-that-is-long-enough-for-session-encryption'

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

function request(method = 'POST', sealed?: string): ApiRequest {
  return {
    method,
    headers: sealed ? { cookie: `${SESSION_COOKIE}=${sealed}` } : {},
    query: {},
  } as unknown as ApiRequest
}

beforeEach(() => {
  process.env.APP_URL = 'https://dev-pulse.siyu.co.nz'
  process.env.SESSION_SECRET = secret
  process.env.GITHUB_CLIENT_ID = 'client-id'
  process.env.GITHUB_CLIENT_SECRET = 'client-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.APP_URL
  delete process.env.SESSION_SECRET
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
})

describe('logout', () => {
  it('returns 405 for GET so third-party pages cannot end the session', async () => {
    const { capture, res } = response()
    await handler(request('GET'), res)
    expect(capture.statusCode).toBe(405)
    expect(capture.headers.Allow).toBe('POST')
  })

  it('revokes the GitHub token, clears both cookies, and redirects', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', upstream)
    const sealed = sealSession({ login: 'SiyuQian', token: 'oauth-token' }, secret)
    const { capture, res } = response()

    await handler(request('POST', sealed), res)

    expect(upstream).toHaveBeenCalledWith(
      'https://api.github.com/applications/client-id/token',
      expect.objectContaining({ method: 'DELETE' }),
    )
    const cookies = capture.headers['Set-Cookie'] as string[]
    expect(
      cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`) && c.includes('Max-Age=0')),
    ).toBe(true)
    expect(
      cookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=;`) && c.includes('Max-Age=0')),
    ).toBe(true)
    expect(capture.redirect).toEqual({
      statusCode: 302,
      url: 'https://dev-pulse.siyu.co.nz/#/',
    })
  })

  it('still clears the cookie when GitHub revocation is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network unavailable')),
    )
    const sealed = sealSession({ login: 'SiyuQian', token: 'oauth-token' }, secret)
    const { capture, res } = response()

    await handler(request('POST', sealed), res)

    const cookies = capture.headers['Set-Cookie'] as string[]
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true)
    expect(capture.redirect?.statusCode).toBe(302)
  })
})
