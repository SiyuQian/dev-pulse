import { randomBytes } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../_lib/http'
import { cookie, cookiesAreSecure, OAUTH_STATE_COOKIE } from '../_lib/session'

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  const appUrl = process.env.APP_URL
  if (!clientId || !appUrl) {
    res.status(500).json({ error: 'GitHub OAuth is not configured' })
    return
  }

  const state = randomBytes(32).toString('base64url')
  res.setHeader(
    'Set-Cookie',
    cookie(OAUTH_STATE_COOKIE, state, {
      maxAge: 600,
      path: '/api/auth',
      secure: cookiesAreSecure(appUrl),
    }),
  )
  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', `${appUrl.replace(/\/$/, '')}/api/auth/callback`)
  authorize.searchParams.set('scope', 'read:user read:org repo')
  authorize.searchParams.set('state', state)
  res.redirect(302, authorize.toString())
}
