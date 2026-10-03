export interface AuthSession {
  login: string
}

export async function fetchSession(): Promise<AuthSession | null> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`Session API error (${response.status})`)
  const body = (await response.json()) as { authenticated?: boolean; login?: unknown }
  if (body.authenticated !== true || typeof body.login !== 'string') {
    throw new Error('Invalid session response')
  }
  return { login: body.login }
}
