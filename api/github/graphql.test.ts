import type { ApiRequest, ApiResponse } from '../_lib/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSession, SESSION_COOKIE } from '../_lib/session'
import handler from './graphql'

const secret = 'test-secret-that-is-long-enough-for-session-encryption'

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function response(): { capture: CapturedResponse; res: ApiResponse } {
  const capture: CapturedResponse = { statusCode: 200, headers: {}, body: undefined }
  const res = {
    setHeader(name: string, value: string) {
      capture.headers[name] = value
      return this
    },
    status(code: number) {
      capture.statusCode = code
      return this
    },
    json(body: unknown) {
      capture.body = body
      return this
    },
    send(body: unknown) {
      capture.body = body
      return this
    },
  } as unknown as ApiResponse
  return { capture, res }
}

function request(query: string, authenticated = true): ApiRequest {
  const sealed = sealSession({ login: 'SiyuQian', token: 'oauth-token' }, secret)
  return {
    method: 'POST',
    headers: { cookie: authenticated ? `${SESSION_COOKIE}=${sealed}` : undefined },
    body: { query, variables: {} },
  } as unknown as ApiRequest
}

beforeEach(() => {
  process.env.ALLOWED_GITHUB_USERS = 'SiyuQian'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SESSION_SECRET
  delete process.env.ALLOWED_GITHUB_USERS
})

describe('GitHub GraphQL proxy', () => {
  it('rejects requests without an authenticated session', async () => {
    process.env.SESSION_SECRET = secret
    const { capture, res } = response()

    await handler(request('query { viewer { login } }', false), res)

    expect(capture.statusCode).toBe(401)
    expect(capture.body).toEqual({ error: 'Not authenticated' })
  })

  it('revokes an existing session when its login leaves the allowlist', async () => {
    process.env.SESSION_SECRET = secret
    process.env.ALLOWED_GITHUB_USERS = 'someone-else'
    const { capture, res } = response()

    await handler(request('query { viewer { login } }'), res)

    expect(capture.statusCode).toBe(401)
    expect(capture.body).toEqual({ error: 'Not authenticated' })
  })

  it('returns 400 for malformed JSON instead of crashing the function', async () => {
    process.env.SESSION_SECRET = secret
    const req = request('query { viewer { login } }')
    req.body = '{'
    const { capture, res } = response()

    await handler(req, res)

    expect(capture.statusCode).toBe(400)
    expect(capture.body).toEqual({ error: 'Invalid JSON body' })
  })

  it('rejects mutations before contacting GitHub', async () => {
    process.env.SESSION_SECRET = secret
    const upstream = vi.fn<() => void>()
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request('mutation { deleteProjectV2(input: {}) { clientMutationId } }'), res)

    expect(capture.statusCode).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('returns 502 when GitHub cannot be reached', async () => {
    process.env.SESSION_SECRET = secret
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network unavailable')),
    )
    const { capture, res } = response()

    await handler(request('query { viewer { login } }'), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'GitHub is unavailable' })
  })

  it('returns 502 when the GitHub response body cannot be read', async () => {
    const unreadable = {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('stream failed')),
    } as unknown as Response
    process.env.SESSION_SECRET = secret
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(unreadable))
    const { capture, res } = response()

    await handler(request('query { viewer { login } }'), res)

    expect(capture.statusCode).toBe(502)
    expect(capture.body).toEqual({ error: 'GitHub is unavailable' })
  })

  it('forwards read-only queries with the server-side OAuth token', async () => {
    process.env.SESSION_SECRET = secret
    const upstream = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('{"data":{"viewer":{"login":"SiyuQian"}}}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    vi.stubGlobal('fetch', upstream)
    const { capture, res } = response()

    await handler(request('query { viewer { login } }'), res)

    expect(capture.statusCode).toBe(200)
    expect(upstream).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer oauth-token' }),
      }),
    )
  })
})
