import type { CiStatus, PullRequest, RateLimitInfo, ReviewDecision } from './types'

export class GitHubError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

async function graphql<T>(
  sessionIdentity: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!sessionIdentity) throw new GitHubError('No authenticated GitHub session')
  const res = await fetch('/api/github/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      // The session cookie expired or the login left the allowlist. Nudge the
      // provider to re-check /api/auth/session so the sign-in screen comes back
      // instead of a broken board (AppState listens for this event).
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('devpulse:unauthorized'))
      throw new GitHubError('Session expired — sign in again', res.status)
    }
    throw new GitHubError(`GitHub API error (${res.status})`, res.status)
  }
  const body = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] }
  if (body.errors?.length) {
    // The primary GraphQL rate limit arrives as HTTP 200 + RATE_LIMITED; 429 lets
    // retryUnlessFatal recognise it alongside the 403 secondary limit.
    if (body.errors.some((e) => e.type === 'RATE_LIMITED')) {
      throw new GitHubError('GitHub rate limit exceeded', 429)
    }
    throw new GitHubError(body.errors[0].message)
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
  search: {
    issueCount: number
    nodes: SearchPrNode[]
    pageInfo?: { hasNextPage: boolean; endCursor: string | null }
  }
  rateLimit: { remaining: number; limit: number; resetAt: string }
}

const SEARCH_PRS_QUERY = /* GraphQL */ `
  query SearchPRs($q: String!, $first: Int!, $after: String) {
    search(query: $q, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
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
          author {
            login
          }
          repository {
            nameWithOwner
          }
          reviewRequests(first: 10) {
            nodes {
              requestedReviewer {
                ... on User {
                  login
                }
                ... on Team {
                  name
                }
              }
            }
          }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
    }
    rateLimit {
      remaining
      limit
      resetAt
    }
  }
`

const SEARCH_PAGE_LIMIT = 10

/**
 * How many requests may be in flight at once across a chunked search. The
 * automatic scope can produce dozens of chunks; firing them all simultaneously
 * through one Vercel Function is a GitHub secondary-rate-limit trigger.
 */
const SEARCH_CONCURRENCY = 5

async function inPool<T>(tasks: (() => Promise<T>)[], limit = SEARCH_CONCURRENCY): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  })
  await Promise.all(workers)
  return results
}

interface OpenSearchResult {
  nodes: SearchPrNode[]
  rateLimit: { remaining: number; limit: number; resetAt: string }
  /** GitHub search stops at 1,000 results; the nodes are what we could get. */
  truncated: boolean
}

async function fetchOpenSearch(token: string, q: string): Promise<OpenSearchResult> {
  const nodes: SearchPrNode[] = []
  let after: string | null = null
  let rateLimit = { remaining: 0, limit: 0, resetAt: '' }

  for (let page = 0; page < SEARCH_PAGE_LIMIT; page++) {
    const result: SearchResult = await graphql<SearchResult>(token, SEARCH_PRS_QUERY, {
      q,
      first: 100,
      after,
    })
    nodes.push(...result.search.nodes)
    rateLimit = result.rateLimit
    if (!result.search.pageInfo?.hasNextPage) {
      return { nodes, rateLimit, truncated: false }
    }
    after = result.search.pageInfo.endCursor
    if (!after) throw new GitHubError('GitHub search pagination returned no cursor')
  }

  // Past the cap (which matches GitHub's own 1,000-result search ceiling):
  // degrade to what was collected rather than taking the whole board down.
  return { nodes, rateLimit, truncated: true }
}

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
  /** One or more search chunks hit GitHub's 1,000-result ceiling. */
  truncated: boolean
}

// A chunk closes on whichever binds first: 20 repo qualifiers, or GitHub's
// 256-character search-query limit — typical repo names mean the length cap
// usually wins, so real chunks hold roughly 8–14 repos.
const REPOS_PER_SEARCH = 20
const SEARCH_QUERY_LIMIT = 256

function repoSearches(repos: string[], prefix: string): string[] {
  const searches: string[] = []
  let qualifiers: string[] = []

  const flush = () => {
    if (qualifiers.length === 0) return
    searches.push(`${prefix} ${qualifiers.join(' ')}`)
    qualifiers = []
  }

  for (const repo of repos) {
    const qualifier = `repo:${repo}`
    const candidate = `${prefix} ${[...qualifiers, qualifier].join(' ')}`
    if (qualifiers.length >= REPOS_PER_SEARCH || candidate.length > SEARCH_QUERY_LIMIT) flush()
    qualifiers.push(qualifier)
  }
  flush()
  return searches
}

// One search query covers repos + authors; GitHub ORs multiple repo:/author: qualifiers of the same kind.
export function buildSearchQuery(
  repos: string[],
  users: string[],
  extra = 'is:pr is:open',
): string {
  const parts = [extra, ...repos.map((r) => `repo:${r}`)]
  if (users.length > 0 && repos.length === 0) parts.push(...users.map((u) => `author:${u}`))
  return parts.join(' ')
}

export async function fetchOpenPrs(
  token: string,
  repos: string[],
  users: string[],
): Promise<OpenPrsResult> {
  // repo: and author: qualifiers AND together across kinds, so repos and
  // authors search separately and merge. The automatic scope can chunk into
  // dozens of repo searches (see repoSearches), so chunks run through a small
  // concurrency pool rather than all at once.
  const queries: string[] = []
  queries.push(...repoSearches(repos, 'is:pr is:open'))
  if (users.length > 0) queries.push(`is:pr is:open ${users.map((u) => `author:${u}`).join(' ')}`)
  if (queries.length === 0)
    return { prs: [], rateLimit: { remaining: 0, limit: 0, resetAt: '' }, truncated: false }

  const results = await inPool(queries.map((q) => () => fetchOpenSearch(token, q)))
  const seen = new Set<string>()
  const prs: PullRequest[] = []
  for (const result of results) {
    for (const node of result.nodes) {
      if (!node.id || seen.has(node.id)) continue
      seen.add(node.id)
      prs.push(toPullRequest(node))
    }
  }
  prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const last = results[results.length - 1].rateLimit
  return {
    prs,
    rateLimit: { remaining: last.remaining, limit: last.limit, resetAt: last.resetAt },
    truncated: results.some((result) => result.truncated),
  }
}

/**
 * Every PR you have open, anywhere — deliberately not scoped to the watchlist.
 *
 * `author:@me` resolves server-side to the token's own account, so this needs no
 * viewer lookup and stays correct the moment the active profile changes. It is
 * the only PR fetch in the app that ignores `config`, which is why the Mine view
 * states its scope on screen: its counts will not match the board's.
 */
export async function fetchMyOpenPrs(token: string): Promise<OpenPrsResult> {
  const result = await fetchOpenSearch(token, 'is:pr is:open author:@me')
  const prs = result.nodes.filter((node) => node.id).map(toPullRequest)
  prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return { prs, rateLimit: result.rateLimit, truncated: result.truncated }
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
  query SearchMerged($q: String!, $first: Int!, $after: String) {
    search(query: $q, type: ISSUE, first: $first, after: $after) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
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
          author {
            login
          }
          repository {
            nameWithOwner
          }
        }
      }
    }
  }
`

interface MergedSearchResult {
  search: {
    issueCount?: number
    nodes: MergedPrNode[]
    pageInfo?: { hasNextPage: boolean; endCursor: string | null }
  }
}

async function fetchMergedSearch(
  token: string,
  q: string,
): Promise<{ nodes: MergedPrNode[]; truncated: boolean }> {
  const nodes: MergedPrNode[] = []
  let after: string | null = null

  for (let page = 0; page < SEARCH_PAGE_LIMIT; page++) {
    const result: MergedSearchResult = await graphql<MergedSearchResult>(
      token,
      SEARCH_MERGED_QUERY,
      {
        q,
        first: 100,
        after,
      },
    )
    nodes.push(...result.search.nodes)
    if (!result.search.pageInfo?.hasNextPage) return { nodes, truncated: false }
    after = result.search.pageInfo.endCursor
    if (!after) throw new GitHubError('GitHub search pagination returned no cursor')
  }

  // Same degrade-not-throw rule as fetchOpenSearch.
  return { nodes, truncated: true }
}

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

function toMergedPr(node: MergedPrNode): MergedPr {
  return {
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
    cycleTimeHours:
      (new Date(node.mergedAt).getTime() - new Date(node.createdAt).getTime()) / 3_600_000,
  }
}

/**
 * Your own recently-merged PRs, unscoped, to sit behind the Mine view's
 * "Merged" toggle. Same `author:@me` reasoning as fetchMyOpenPrs.
 */
export interface MergedPrsResult {
  prs: MergedPr[]
  truncated: boolean
}

export async function fetchMyMergedPrs(token: string, sinceIso: string): Promise<MergedPrsResult> {
  const result = await fetchMergedSearch(
    token,
    `is:pr is:merged author:@me merged:>=${sinceIso.slice(0, 10)}`,
  )
  const prs = result.nodes.filter((node) => node.id).map(toMergedPr)
  prs.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1))
  return { prs, truncated: result.truncated }
}

export async function fetchMergedPrs(
  token: string,
  repos: string[],
  users: string[],
  sinceIso: string,
): Promise<MergedPrsResult> {
  const since = sinceIso.slice(0, 10)
  const queries: string[] = []
  queries.push(...repoSearches(repos, `is:pr is:merged merged:>=${since}`))
  if (users.length > 0)
    queries.push(`is:pr is:merged merged:>=${since} ${users.map((u) => `author:${u}`).join(' ')}`)
  if (queries.length === 0) return { prs: [], truncated: false }

  const results = await inPool(queries.map((q) => () => fetchMergedSearch(token, q)))
  const seen = new Set<string>()
  const prs: MergedPr[] = []
  for (const result of results) {
    for (const node of result.nodes) {
      if (!node.id || seen.has(node.id)) continue
      seen.add(node.id)
      prs.push(toMergedPr(node))
    }
  }
  prs.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1))
  return { prs, truncated: results.some((result) => result.truncated) }
}

export async function fetchViewerLogin(token: string): Promise<string> {
  // Named so the proxy's operation allowlist (api/github/graphql.ts) can pin it.
  const data = await graphql<{ viewer: { login: string } }>(
    token,
    'query ViewerLogin { viewer { login } }',
    {},
  )
  return data.viewer.login
}

export interface ViewerRepo {
  nameWithOwner: string
  isPrivate: boolean
  isArchived: boolean
}

const VIEWER_REPOS_QUERY = /* GraphQL */ `
  query ViewerRepos($first: Int!, $after: String) {
    viewer {
      repositories(
        first: $first
        after: $after
        affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          nameWithOwner
          isPrivate
          isArchived
        }
      }
    }
  }
`

export interface ViewerRepoPage {
  repos: ViewerRepo[]
  nextCursor: string | null
}

/** One page of the repos the token can see, most-recently-pushed first. */
export async function fetchViewerRepoPage(
  token: string,
  after: string | null,
): Promise<ViewerRepoPage> {
  const data: {
    viewer: {
      repositories: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ViewerRepo[]
      }
    }
  } = await graphql(token, VIEWER_REPOS_QUERY, { first: 100, after })
  const { nodes, pageInfo } = data.viewer.repositories
  if (pageInfo.hasNextPage && !pageInfo.endCursor) {
    throw new GitHubError('Repository pagination returned no cursor')
  }
  return { repos: nodes, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null }
}

/**
 * Keeps a large account's repo walk bounded (10 × 100 repos). `orderBy:
 * PUSHED_AT DESC` means hitting the cap keeps the most active repos; the
 * `truncated` flag surfaces in the UI rather than silently narrowing scope.
 */
const VIEWER_REPO_PAGE_LIMIT = 10

export interface AllViewerRepos {
  repos: ViewerRepo[]
  truncated: boolean
}

/** Walks the visible repository connection, bounded, before the dashboard renders. */
export async function fetchAllViewerRepos(token: string): Promise<AllViewerRepos> {
  const repos: ViewerRepo[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let page = 0; page < VIEWER_REPO_PAGE_LIMIT; page++) {
    const result = await fetchViewerRepoPage(token, cursor)
    repos.push(...result.repos)
    cursor = result.nextCursor
    if (!cursor) return { repos, truncated: false }
    if (seenCursors.has(cursor)) throw new GitHubError('Repository pagination cursor repeated')
    seenCursors.add(cursor)
  }

  return { repos, truncated: true }
}
