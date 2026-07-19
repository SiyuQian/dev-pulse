import type { CiStatus, PullRequest, RateLimitInfo, ReviewDecision } from './types'

const GRAPHQL_URL = 'https://api.github.com/graphql'

export class GitHubError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!token) throw new GitHubError('No GitHub token configured')
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new GitHubError(res.status === 401 ? 'Invalid or expired token' : `GitHub API error (${res.status})`, res.status)
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] }
  if (body.errors?.length) {
    const rateLimited = body.errors.some((e) => e.type === 'RATE_LIMITED')
    throw new GitHubError(rateLimited ? 'GitHub rate limit exceeded' : body.errors[0].message)
  }
  if (!body.data) throw new GitHubError('Empty GraphQL response')
  return body.data
}

interface SearchPrNode {
  id: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  reviewDecision: ReviewDecision
  author: { login: string } | null
  repository: { nameWithOwner: string }
  reviewRequests: { nodes: { requestedReviewer: { login?: string; name?: string } | null }[] }
  commits: { nodes: { commit: { statusCheckRollup: { state: CiStatus } | null } }[] }
}

interface SearchResult {
  search: { issueCount: number; nodes: SearchPrNode[] }
  rateLimit: { remaining: number; limit: number; resetAt: string }
}

const SEARCH_PRS_QUERY = /* GraphQL */ `
  query SearchPRs($q: String!, $first: Int!) {
    search(query: $q, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          additions
          deletions
          reviewDecision
          author { login }
          repository { nameWithOwner }
          reviewRequests(first: 10) {
            nodes {
              requestedReviewer {
                ... on User { login }
                ... on Team { name }
              }
            }
          }
          commits(last: 1) {
            nodes { commit { statusCheckRollup { state } } }
          }
        }
      }
    }
    rateLimit { remaining limit resetAt }
  }
`

function toPullRequest(node: SearchPrNode): PullRequest {
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? 'ghost',
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    reviewDecision: node.reviewDecision,
    ciStatus: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
    requestedReviewers: node.reviewRequests.nodes
      .map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name)
      .filter((r): r is string => Boolean(r)),
    additions: node.additions,
    deletions: node.deletions,
  }
}

export interface OpenPrsResult {
  prs: PullRequest[]
  rateLimit: RateLimitInfo
}

// One search query covers repos + authors; GitHub ORs multiple repo:/author: qualifiers of the same kind.
export function buildSearchQuery(repos: string[], users: string[], extra = 'is:pr is:open'): string {
  const parts = [extra, ...repos.map((r) => `repo:${r}`)]
  if (users.length > 0 && repos.length === 0) parts.push(...users.map((u) => `author:${u}`))
  return parts.join(' ')
}

export async function fetchOpenPrs(token: string, repos: string[], users: string[]): Promise<OpenPrsResult> {
  // repo: and author: qualifiers AND together across kinds, so when both are set
  // we run two searches (watched repos, watched authors) and merge.
  const queries: string[] = []
  if (repos.length > 0) queries.push(buildSearchQuery(repos, []))
  if (users.length > 0) queries.push(`is:pr is:open ${users.map((u) => `author:${u}`).join(' ')}`)
  if (queries.length === 0) return { prs: [], rateLimit: { remaining: 0, limit: 0, resetAt: '' } }

  const results = await Promise.all(
    queries.map((q) => graphql<SearchResult>(token, SEARCH_PRS_QUERY, { q, first: 50 })),
  )
  const seen = new Set<string>()
  const prs: PullRequest[] = []
  for (const result of results) {
    for (const node of result.search.nodes) {
      if (!node.id || seen.has(node.id)) continue
      seen.add(node.id)
      prs.push(toPullRequest(node))
    }
  }
  prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const last = results[results.length - 1].rateLimit
  return { prs, rateLimit: { remaining: last.remaining, limit: last.limit, resetAt: last.resetAt } }
}

interface MergedPrNode {
  id: string
  number: number
  title: string
  url: string
  createdAt: string
  mergedAt: string
  additions: number
  deletions: number
  author: { login: string } | null
  repository: { nameWithOwner: string }
}

const SEARCH_MERGED_QUERY = /* GraphQL */ `
  query SearchMerged($q: String!, $first: Int!) {
    search(query: $q, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          createdAt
          mergedAt
          additions
          deletions
          author { login }
          repository { nameWithOwner }
        }
      }
    }
  }
`

export interface MergedPr {
  id: string
  number: number
  title: string
  url: string
  repo: string
  author: string
  createdAt: string
  mergedAt: string
  additions: number
  deletions: number
  cycleTimeHours: number
}

export async function fetchMergedPrs(
  token: string,
  repos: string[],
  users: string[],
  sinceIso: string,
): Promise<MergedPr[]> {
  const since = sinceIso.slice(0, 10)
  const queries: string[] = []
  if (repos.length > 0) queries.push(`is:pr is:merged merged:>=${since} ${repos.map((r) => `repo:${r}`).join(' ')}`)
  if (users.length > 0) queries.push(`is:pr is:merged merged:>=${since} ${users.map((u) => `author:${u}`).join(' ')}`)
  if (queries.length === 0) return []

  const results = await Promise.all(
    queries.map((q) => graphql<{ search: { nodes: MergedPrNode[] } }>(token, SEARCH_MERGED_QUERY, { q, first: 100 })),
  )
  const seen = new Set<string>()
  const prs: MergedPr[] = []
  for (const result of results) {
    for (const node of result.search.nodes) {
      if (!node.id || seen.has(node.id)) continue
      seen.add(node.id)
      prs.push({
        id: node.id,
        number: node.number,
        title: node.title,
        url: node.url,
        repo: node.repository.nameWithOwner,
        author: node.author?.login ?? 'ghost',
        createdAt: node.createdAt,
        mergedAt: node.mergedAt,
        additions: node.additions,
        deletions: node.deletions,
        cycleTimeHours: (new Date(node.mergedAt).getTime() - new Date(node.createdAt).getTime()) / 3_600_000,
      })
    }
  }
  prs.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1))
  return prs
}

export async function fetchViewerLogin(token: string): Promise<string> {
  const data = await graphql<{ viewer: { login: string } }>(token, 'query { viewer { login } }', {})
  return data.viewer.login
}
