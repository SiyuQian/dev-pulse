import type { ApiRequest, ApiResponse } from '../_lib/http'
import { isAllowedLogin, openSession, readCookie, SESSION_COOKIE } from '../_lib/session'

export default function handler(req: ApiRequest, res: ApiResponse): void {
  res.setHeader('Cache-Control', 'private, no-store')
  const secret = process.env.SESSION_SECRET
  const sealed = readCookie(req.headers.cookie, SESSION_COOKIE)
  const session = secret && sealed ? openSession(sealed, secret) : null
  if (!session || !isAllowedLogin(session.login, process.env.ALLOWED_GITHUB_USERS)) {
    res.status(401).json({ authenticated: false })
    return
  }
  res.status(200).json({ authenticated: true, login: session.login })
}
