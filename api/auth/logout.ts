import type { ApiRequest, ApiResponse } from '../_lib/http'
import {
  cookie,
  cookiesAreSecure,
  OAUTH_STATE_COOKIE,
  openSession,
  readCookie,
  SESSION_COOKIE,
} from '../_lib/session'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  // POST-only: a GET logout is CSRF-able via a third-party <img> tag.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const appUrl = process.env.APP_URL?.replace(/\/$/, '')
  const secure = appUrl ? cookiesAreSecure(appUrl) : true

  // The sealed cookie is stateless, so clearing it cannot invalidate an
  // already-captured copy — revoking the GitHub token underneath it can.
  // Best-effort: sign-out must still clear the cookie when GitHub is down.
  const secret = process.env.SESSION_SECRET
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const sealed = readCookie(req.headers.cookie, SESSION_COOKIE)
  const session = secret && sealed ? openSession(sealed, secret) : null
  if (session && clientId && clientSecret) {
    try {
      await fetch(`https://api.github.com/applications/${clientId}/token`, {
        method: 'DELETE',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: session.token }),
      })
    } catch {
      // GitHub unreachable — the cookie still dies below.
    }
  }

  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, '', { maxAge: 0, secure }),
    cookie(OAUTH_STATE_COOKIE, '', { maxAge: 0, path: '/api/auth', secure }),
  ])
  res.redirect(302, `${appUrl ?? ''}/#/`)
}
