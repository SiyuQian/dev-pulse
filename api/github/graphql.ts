import type { ApiRequest, ApiResponse } from '../_lib/http'
import { isAllowedLogin, openSession, readCookie, SESSION_COOKIE } from '../_lib/session'

interface GraphQLRequest {
  query?: unknown
  variables?: unknown
}

/**
 * The OAuth `repo` grant is read-write; read-only is enforced here, not by the
 * grant. Only the app's own named operations (src/api/github.ts) are forwarded,
 * which rejects mutations and arbitrary queries alike.
 */
const ALLOWED_OPERATIONS = new Set(['SearchPRs', 'SearchMerged', 'ViewerRepos', 'ViewerLogin'])

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const secret = process.env.SESSION_SECRET
  const sealed = readCookie(req.headers.cookie, SESSION_COOKIE)
  const session = secret && sealed ? openSession(sealed, secret) : null
  if (!session || !isAllowedLogin(session.login, process.env.ALLOWED_GITHUB_USERS)) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  let body: GraphQLRequest
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as GraphQLRequest
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }
  if (typeof body?.query !== 'string' || body.query.length > 50_000) {
    res.status(400).json({ error: 'Invalid GraphQL query' })
    return
  }
  const operation = /^\s*query\s+([A-Za-z0-9_]+)\s*[({]/.exec(body.query)?.[1]
  if (!operation || !ALLOWED_OPERATIONS.has(operation)) {
    res.status(403).json({ error: 'Only the dashboard read-only queries are allowed' })
    return
  }

  let upstream: Response
  try {
    upstream = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query: body.query, variables: body.variables ?? {} }),
    })
  } catch {
    res.status(502).json({ error: 'GitHub is unavailable' })
    return
  }
  let responseBody: string
  try {
    responseBody = await upstream.text()
  } catch {
    res.status(502).json({ error: 'GitHub is unavailable' })
    return
  }
  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
  res.send(responseBody)
}
