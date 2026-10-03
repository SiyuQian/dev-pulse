import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'devpulse_session'
export const OAUTH_STATE_COOKIE = 'devpulse_oauth_state'

export interface GitHubSession {
  login: string
  token: string
  expiresAt: number
}

type GitHubSessionInput = Omit<GitHubSession, 'expiresAt'>
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function keyFrom(secret: string): Buffer {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  return createHash('sha256').update(secret).digest()
}

export function sealSession(session: GitHubSessionInput, secret: string, now = Date.now()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const payload: GitHubSession = { ...session, expiresAt: now + SESSION_TTL_MS }
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.')
}

export function openSession(value: string, secret: string, now = Date.now()): GitHubSession | null {
  try {
    const [ivPart, tagPart, encryptedPart, extra] = value.split('.')
    if (!ivPart || !tagPart || !encryptedPart || extra) return null
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(secret),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ])
    const parsed = JSON.parse(decrypted.toString('utf8')) as Partial<GitHubSession>
    return typeof parsed.login === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > now
      ? { login: parsed.login, token: parsed.token, expiresAt: parsed.expiresAt }
      : null
  } catch {
    return null
  }
}

export function isAllowedLogin(login: string, configured: string | undefined): boolean {
  const allowed = (configured ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(login.toLowerCase())
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const item of (header ?? '').split(';')) {
    const [key, ...value] = item.trim().split('=')
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='))
      } catch {
        return null
      }
    }
  }
  return null
}

export function cookiesAreSecure(appUrl: string): boolean {
  const url = new URL(appUrl)
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    return false
  }
  throw new Error('APP_URL must use HTTPS outside localhost')
}

export function cookie(
  name: string,
  value: string,
  options: { maxAge: number; path?: string; secure?: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path ?? '/'}`,
    'HttpOnly',
    options.secure === false ? null : 'Secure',
    'SameSite=Lax',
  ]
    .filter((part): part is string => part !== null)
    .join('; ')
}
