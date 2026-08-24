import type { ApiRequest, ApiResponse } from '../_lib/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSession, OAUTH_STATE_COOKIE, SESSION_COOKIE } from '../_lib/session'
import handler from './callback'

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
    send(body: unknown) {
      capture.body = body
    },
    redirect(statusCode: number, url: string) {
      capture.statusCode = statusCode
      capture.redirect = { statusCode, url }
    },
  } as ApiResponse
  return { capture, res }
}

function request(): ApiRequest {
  return {
    method: 'GET',
    headers: { cookie: `${OAUTH_STATE_COOKIE}=expected-state` },
    query: { code: 'oauth-code', state: 'expected-state' },
  } as unknown as ApiRequest
}

beforeEach(() => {
  process.env.APP_URL = 'https://dev-pulse.siyu.co.nz'
  process.env.GITHUB_CLIENT_ID = 'client-id'
  process.env.GITHUB_CLIENT_SECRET = 'client-secret'
  process.env.SESSION_SECRET = 'a-session-secret-that-is-at-least-32-characters'
  process.env.ALLOWED_GITHUB_USERS = 'SiyuQian'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.APP_URL
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
  delete process.env.SESSION_SECRET
  delete process.env.ALLOWED_GITHUB_USERS
})

describe('GitHub OAuth callback', () => {
  it('returns 502 when the token endpoint cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network unavailable')),
    )
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'GitHub OAuth is unavailable' })
  })

  it('returns 502 when the token endpoint returns malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid response from GitHub OAuth' })
  })

  it('rejects a null token response payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ),
    )
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid response from GitHub OAuth' })
  })

  it('rejects a malformed access token field', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid response from GitHub OAuth' })
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when the GitHub identity endpoint cannot be reached', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }),
      )
      .mockRejectedValueOnce(new Error('network unavailable'))
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Could not load GitHub identity' })
  })

  it('returns 502 when the GitHub identity endpoint returns malformed JSON', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid GitHub identity response' })
  })

  it('rejects a null GitHub identity payload', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('null', { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid GitHub identity response' })
  })

  it('rejects a GitHub identity without a valid login', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ login: 42 }), { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'Invalid GitHub identity response' })
  })

  it('rejects an OAuth state mismatch before contacting GitHub', async () => {
    const upstream = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', upstream)
    const req = request()
    req.query.state = 'wrong-state'
    const { capture, res } = response()

    await handler(req, res)

    expect(capture.statusCode).toBe(400)
    expect(capture.body).toEqual({ error: 'Invalid OAuth callback' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('issues an encrypted session and clears OAuth state after success', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ login: 'SiyuQian' }), { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request(), res)

    expect(capture.redirect).toEqual({
      statusCode: 302,
      url: 'https://dev-pulse.siyu.co.nz/#/',
    })
    const cookies = capture.headers['Set-Cookie']
    expect(Array.isArray(cookies)).toBe(true)
    const sessionCookie = (cookies as string[]).find((value) =>
      value.startsWith(`${SESSION_COOKIE}=`),
    )
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie).not.toContain('oauth-token')
    const sealed = decodeURIComponent(
      sessionCookie!.split(';')[0].slice(`${SESSION_COOKIE}=`.length),
    )
    expect(openSession(sealed, process.env.SESSION_SECRET!)).toMatchObject({
      login: 'SiyuQian',
      token: 'oauth-token',
    })
    expect(
      (cookies as string[]).some(
        (value) => value.startsWith(`${OAUTH_STATE_COOKIE}=`) && value.includes('Max-Age=0'),
      ),
    ).toBe(true)
  })
})
