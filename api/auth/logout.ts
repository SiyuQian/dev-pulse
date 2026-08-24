import type { ApiRequest, ApiResponse } from '../_lib/http'
import { cookie, cookiesAreSecure, SESSION_COOKIE } from '../_lib/session'

export default function handler(_req: ApiRequest, res: ApiResponse): void {
  const appUrl = process.env.APP_URL?.replace(/\/$/, '')
  res.setHeader(
    'Set-Cookie',
    cookie(SESSION_COOKIE, '', {
      maxAge: 0,
      secure: appUrl ? cookiesAreSecure(appUrl) : true,
    }),
  )
  res.redirect(302, `${appUrl ?? '/'}#/`)
}
