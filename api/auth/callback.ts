import { timingSafeEqual } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../_lib/http'
import {
  cookie,
  cookiesAreSecure,
  isAllowedLogin,
  OAUTH_STATE_COOKIE,
  readCookie,
  sealSession,
  SESSION_COOKIE,
} from '../_lib/session'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameState(expected: string | null, received: string | undefined): boolean {
  if (!expected || !received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const appUrl = process.env.APP_URL?.replace(/\/$/, '')
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const sessionSecret = process.env.SESSION_SECRET
  if (!appUrl || !clientId || !clientSecret || !sessionSecret) {
    res.status(500).json({ error: 'GitHub OAuth is not configured' })
    return
  }
  const secure = cookiesAreSecure(appUrl)

  const code = typeof req.query.code === 'string' ? req.query.code : undefined
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const expectedState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE)
  if (!code || !sameState(expectedState, state)) {
    res.status(400).json({ error: 'Invalid OAuth callback' })
    return
  }

  let tokenResponse: Response
  try {
    tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
  } catch {
    res.status(502).json({ error: 'GitHub OAuth is unavailable' })
    return
  }
  let tokenBody: unknown
  try {
    tokenBody = await tokenResponse.json()
  } catch {
    res.status(502).json({ error: 'Invalid response from GitHub OAuth' })
    return
  }
  const tokenRecord = isRecord(tokenBody) ? tokenBody : null
  if (!tokenResponse.ok) {
    const detail = tokenRecord?.error_description
    const error = tokenRecord?.error
    res.status(502).json({
      error:
        (typeof detail === 'string' && detail) ||
        (typeof error === 'string' && error) ||
        'OAuth failed',
    })
    return
  }
  if (
    !tokenRecord ||
    typeof tokenRecord.access_token !== 'string' ||
    tokenRecord.access_token.trim() === ''
  ) {
    res.status(502).json({ error: 'Invalid response from GitHub OAuth' })
    return
  }
  const accessToken = tokenRecord.access_token

  let userResponse: Response
  try {
    userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    res.status(502).json({ error: 'Could not load GitHub identity' })
    return
  }
  if (!userResponse.ok) {
    res.status(502).json({ error: 'Could not load GitHub identity' })
    return
  }
  let userBody: unknown
  try {
    userBody = await userResponse.json()
  } catch {
    res.status(502).json({ error: 'Invalid GitHub identity response' })
    return
  }
  const user = isRecord(userBody) ? userBody : null
  if (!user || typeof user.login !== 'string' || user.login.trim() === '') {
    res.status(502).json({ error: 'Invalid GitHub identity response' })
    return
  }
  if (!isAllowedLogin(user.login, process.env.ALLOWED_GITHUB_USERS)) {
    res.setHeader(
      'Set-Cookie',
      cookie(OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/api/auth', secure }),
    )
    res.redirect(302, `${appUrl}/?auth=forbidden#/`)
    return
  }

  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, sealSession({ login: user.login, token: accessToken }, sessionSecret), {
      maxAge: 7 * 24 * 60 * 60,
      secure,
    }),
    cookie(OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/api/auth', secure }),
  ])
  res.redirect(302, `${appUrl}/#/`)
}
