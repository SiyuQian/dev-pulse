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

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
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
    throw new GitHubError(
      res.status === 401 ? 'Invalid or expired token' : `GitHub API error (${res.status})`,
      res.status,
    )
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
  if (repos.length > 0)
    queries.push(`is:pr is:merged merged:>=${since} ${repos.map((r) => `repo:${r}`).join(' ')}`)
  if (users.length > 0)
    queries.push(`is:pr is:merged merged:>=${since} ${users.map((u) => `author:${u}`).join(' ')}`)
  if (queries.length === 0) return []

  const results = await Promise.all(
    queries.map((q) =>
      graphql<{ search: { nodes: MergedPrNode[] } }>(token, SEARCH_MERGED_QUERY, { q, first: 100 }),
    ),
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
        cycleTimeHours:
          (new Date(node.mergedAt).getTime() - new Date(node.createdAt).getTime()) / 3_600_000,
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

/**
 * One page of the repos the token can see, most-recently-pushed first.
 *
 * GraphQL cursor pagination is inherently serial, so this returns a single page
 * rather than awaiting the whole walk — the repo picker renders from page one
 * while the caller backfills the rest in the background (see useViewerRepos).
 */
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
  return { repos: nodes, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null }
}

export interface OrgMember {
  login: string
  /** Display name, when the member has set one. */
  name: string | null
  /** The org this member was found in — used to group the picker. */
  org: string
}

/**
 * Where the org-member walk got to: which orgs there are, which one we're in,
 * and how far through its members. Members paginate per org, so a plain cursor
 * isn't enough — the walk has to carry the org list with it.
 */
export interface OrgMemberCursor {
  orgs: string[]
  index: number
  after: string | null
}

/** An org the walk passed over, and what GitHub said when it tried. */
export interface SkippedOrg {
  org: string
  reason: string
}

export interface OrgMemberPage {
  members: OrgMember[]
  /** Null once every org has been walked. */
  next: OrgMemberCursor | null
  /**
   * Every org this walk covers. Carried on each page so the picker can tell
   * "your token reports no orgs at all" apart from "your orgs returned nobody" —
   * the two have completely different fixes and used to look identical.
   */
  orgs: string[]
  /**
   * Orgs skipped on *this* page because their member list wasn't readable.
   * Silently dropping these is what made an unusable token look like an empty
   * org: GitHub answers "org you can't see" with HTTP 200 + a NOT_FOUND error,
   * so nothing downstream had any way to know.
   */
  skipped: SkippedOrg[]
}

/** Enough for anyone's org list; beyond this the picker's search is the answer. */
const VIEWER_ORGS_LIMIT = 25

const VIEWER_ORGS_QUERY = /* GraphQL */ `
  query ViewerOrgs($first: Int!) {
    viewer {
      organizations(first: $first) {
        nodes {
          login
        }
      }
    }
  }
`

const ORG_MEMBERS_QUERY = /* GraphQL */ `
  query OrgMembers($org: String!, $first: Int!, $after: String) {
    organization(login: $org) {
      membersWithRole(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          login
          name
        }
      }
    }
  }
`

export async function fetchViewerOrgs(token: string): Promise<string[]> {
  const data = await graphql<{ viewer: { organizations: { nodes: { login: string }[] } } }>(
    token,
    VIEWER_ORGS_QUERY,
    { first: VIEWER_ORGS_LIMIT },
  )
  return data.viewer.organizations.nodes.map((node) => node.login)
}

interface OrgMembersData {
  organization: {
    membersWithRole: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: { login: string; name: string | null }[]
    }
  } | null
}

/**
 * One page of teammates from the orgs the viewer belongs to, so Settings can
 * offer real colleagues instead of asking people to remember logins.
 *
 * Members paginate per org and cursors are serial, so this returns a single
 * page and a cursor to resume from — the picker renders page one immediately
 * and the caller backfills the rest (see useOrgMembers). Orgs whose member list
 * the token can't read are skipped rather than failing the walk: a fine-grained
 * PAT is scoped to one org, and its "Members" permission is opt-in.
 */
export async function fetchOrgMemberPage(
  token: string,
  cursor: OrgMemberCursor | null,
): Promise<OrgMemberPage> {
  const orgs = cursor?.orgs ?? (await fetchViewerOrgs(token))
  let index = cursor?.index ?? 0
  let after = cursor?.after ?? null
  const skipped: SkippedOrg[] = []

  while (index < orgs.length) {
    const org = orgs[index]
    try {
      const data = await graphql<OrgMembersData>(token, ORG_MEMBERS_QUERY, {
        org,
        first: 100,
        after,
      })
      const page = data.organization?.membersWithRole
      if (page) {
        const members = page.nodes.map((node) => ({ login: node.login, name: node.name, org }))
        const hasMoreInOrg = page.pageInfo.hasNextPage
        const nextIndex = hasMoreInOrg ? index : index + 1
        return {
          members,
          next:
            hasMoreInOrg || nextIndex < orgs.length
              ? { orgs, index: nextIndex, after: hasMoreInOrg ? page.pageInfo.endCursor : null }
              : null,
          orgs,
          skipped,
        }
      }
      // A 200 with `organization: null` and no thrown error: nothing to report
      // beyond "this token can't resolve the org".
      skipped.push({ org, reason: 'Not visible to this token' })
    } catch (error) {
      // A dead token is fatal everywhere; anything else here means "this org
      // won't tell us", which the next org might well not repeat.
      if (error instanceof GitHubError && error.status === 401) throw error
      skipped.push({ org, reason: error instanceof Error ? error.message : 'Unknown error' })
    }
    index++
    after = null
  }

  return { members: [], next: null, orgs, skipped }
}
