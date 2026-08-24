import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAllViewerRepos,
  fetchMyMergedPrs,
  fetchMyOpenPrs,
  fetchMergedPrs,
  fetchOpenPrs,
  fetchOrgMemberPage,
  type OrgMemberCursor,
} from './github'

interface GraphQLCall {
  query: string
  variables: Record<string, unknown>
}

/**
 * Queues one response per call, in order, and records what was asked for. Each
 * entry is either the `data` payload or a `{ errors }` body — the latter is how
 * GitHub reports "this org won't tell you who's in it".
 */
function mockGraphQL(responses: unknown[]): GraphQLCall[] {
  const calls: GraphQLCall[] = []
  let i = 0
  vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as GraphQLCall
    calls.push(body)
    const next = responses[i++]
    const payload =
      next && typeof next === 'object' && 'errors' in next ? next : { data: next as object }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) })
  })
  return calls
}

const orgsResponse = (...logins: string[]) => ({
  viewer: { organizations: { nodes: logins.map((login) => ({ login })) } },
})

const membersResponse = (
  nodes: { login: string; name: string | null }[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
) => ({ organization: { membersWithRole: { pageInfo, nodes } } })

afterEach(() => {
  vi.unstubAllGlobals()
})

const searchPrNode = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr1',
  number: 7,
  title: 'Add the thing',
  url: 'https://github.com/acme/app/pull/7',
  isDraft: false,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-02T00:00:00Z',
  additions: 10,
  deletions: 2,
  reviewDecision: 'REVIEW_REQUIRED',
  author: { login: 'ada' },
  repository: { nameWithOwner: 'acme/app' },
  reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...overrides,
})

const searchMergedNode = (id: string) => ({
  id,
  number: 7,
  title: 'Merged thing',
  url: 'https://github.com/acme/app/pull/7',
  createdAt: '2026-07-01T00:00:00Z',
  mergedAt: '2026-07-02T12:00:00Z',
  additions: 10,
  deletions: 2,
  author: { login: 'ada' },
  repository: { nameWithOwner: 'acme/app' },
})

const rateLimit = { remaining: 4900, limit: 5000, resetAt: '2026-07-29T10:00:00Z' }

describe('fetchMyOpenPrs', () => {
  it('always uses the authenticated Vercel proxy without sending browser credentials', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { search: { issueCount: 0, nodes: [] }, rateLimit },
          }),
      })
    })

    await fetchMyOpenPrs('legacy-pat-looking-value')

    expect(calls[0].url).toBe('/api/github/graphql')
    expect(calls[0].init.credentials).toBe('same-origin')
    expect(calls[0].init.headers).not.toHaveProperty('Authorization')
  })

  it('searches author:@me in one request, with no watchlist qualifiers', async () => {
    const calls = mockGraphQL([{ search: { issueCount: 1, nodes: [searchPrNode()] }, rateLimit }])

    const result = await fetchMyOpenPrs('tok')

    expect(calls).toHaveLength(1)
    expect(calls[0].variables.q).toBe('is:pr is:open author:@me')
    expect(result.prs).toHaveLength(1)
    expect(result.prs[0]).toMatchObject({ repo: 'acme/app', author: 'ada', number: 7 })
    expect(result.rateLimit).toEqual(rateLimit)
  })

  it('sorts most-recently-updated first', async () => {
    mockGraphQL([
      {
        search: {
          issueCount: 2,
          nodes: [
            searchPrNode({ id: 'old', updatedAt: '2026-07-01T00:00:00Z' }),
            searchPrNode({ id: 'new', updatedAt: '2026-07-20T00:00:00Z' }),
          ],
        },
        rateLimit,
      },
    ])

    const result = await fetchMyOpenPrs('tok')

    expect(result.prs.map((p) => p.id)).toEqual(['new', 'old'])
  })

  /**
   * `search` returns `type: ISSUE` results, and anything that isn't a PullRequest
   * comes back as an empty node rather than being filtered server-side.
   */
  it('drops nodes that are not pull requests', async () => {
    mockGraphQL([{ search: { issueCount: 2, nodes: [{}, searchPrNode()] }, rateLimit }])

    const result = await fetchMyOpenPrs('tok')

    expect(result.prs).toHaveLength(1)
  })
})

describe('fetchOpenPrs', () => {
  it('chunks automatically discovered repositories into bounded searches', async () => {
    const calls = mockGraphQL(
      Array.from({ length: 45 }, () => ({ search: { issueCount: 0, nodes: [] }, rateLimit })),
    )
    const repos = Array.from({ length: 45 }, (_, i) => `acme/repo-${i + 1}`)

    await fetchOpenPrs('tok', repos, [])

    expect(calls.length).toBeGreaterThan(1)
    expect(
      calls.reduce(
        (total, call) => total + ((call.variables.q as string).match(/repo:/g)?.length ?? 0),
        0,
      ),
    ).toBe(45)
    expect(calls.every((call) => (call.variables.q as string).length <= 256)).toBe(true)
  })

  it('paginates every repository search instead of dropping later open PRs', async () => {
    const calls = mockGraphQL([
      {
        search: {
          issueCount: 2,
          nodes: [searchPrNode({ id: 'page-1' })],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
        rateLimit,
      },
      {
        search: {
          issueCount: 2,
          nodes: [searchPrNode({ id: 'page-2' })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        rateLimit,
      },
    ])

    const result = await fetchOpenPrs('tok', ['acme/app'], [])

    expect(result.prs.map((pr) => pr.id).sort()).toEqual(['page-1', 'page-2'])
    expect(calls.map((call) => call.variables.after)).toEqual([null, 'cursor-1'])
  })

  it('rejects an open search truncated by GitHub at 1,000 results', async () => {
    mockGraphQL([
      {
        search: {
          issueCount: 1001,
          nodes: [searchPrNode({ id: 'truncated' })],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
        rateLimit,
      },
    ])

    await expect(fetchOpenPrs('tok', ['acme/app'], [])).rejects.toThrow(
      'GitHub search exceeds the 1,000-result limit',
    )
  })

  it('chunks automatically discovered repositories for merged history too', async () => {
    const calls = mockGraphQL(Array.from({ length: 2 }, () => ({ search: { nodes: [] } })))
    const repos = Array.from({ length: 21 }, (_, i) => `acme/repo-${i + 1}`)

    await fetchMergedPrs('tok', repos, [], '2026-08-01T00:00:00Z')

    expect(calls.length).toBeGreaterThan(1)
    expect(
      calls.reduce(
        (total, call) => total + ((call.variables.q as string).match(/repo:/g)?.length ?? 0),
        0,
      ),
    ).toBe(21)
    expect(calls.every((call) => (call.variables.q as string).length <= 256)).toBe(true)
  })

  it('paginates every repository search instead of dropping later merged PRs', async () => {
    const calls = mockGraphQL([
      {
        search: {
          nodes: [searchMergedNode('merged-page-1')],
          pageInfo: { hasNextPage: true, endCursor: 'merged-cursor-1' },
        },
      },
      {
        search: {
          nodes: [searchMergedNode('merged-page-2')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ])

    const result = await fetchMergedPrs('tok', ['acme/app'], [], '2026-08-01T00:00:00Z')

    expect(result.map((pr) => pr.id).sort()).toEqual(['merged-page-1', 'merged-page-2'])
    expect(calls.map((call) => call.variables.after)).toEqual([null, 'merged-cursor-1'])
  })

  it('rejects a merged search truncated by GitHub at 1,000 results', async () => {
    mockGraphQL([
      {
        search: {
          issueCount: 1001,
          nodes: [searchMergedNode('truncated-merged')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ])

    await expect(fetchMergedPrs('tok', ['acme/app'], [], '2026-08-01T00:00:00Z')).rejects.toThrow(
      'GitHub search exceeds the 1,000-result limit',
    )
  })
})

describe('fetchMyMergedPrs', () => {
  it('scopes the search to author:@me and the given date, and derives cycle time', async () => {
    const calls = mockGraphQL([
      {
        search: {
          nodes: [
            {
              id: 'pr1',
              number: 7,
              title: 'Add the thing',
              url: 'https://github.com/acme/app/pull/7',
              createdAt: '2026-07-01T00:00:00Z',
              mergedAt: '2026-07-02T12:00:00Z',
              additions: 10,
              deletions: 2,
              author: { login: 'ada' },
              repository: { nameWithOwner: 'acme/app' },
            },
          ],
        },
      },
    ])

    const prs = await fetchMyMergedPrs('tok', '2026-06-29T08:30:00Z')

    expect(calls[0].variables.q).toBe('is:pr is:merged author:@me merged:>=2026-06-29')
    expect(prs[0].cycleTimeHours).toBe(36)
  })
})

describe('fetchAllViewerRepos', () => {
  it('walks every repository page without the old five-page cap', async () => {
    const calls = mockGraphQL(
      Array.from({ length: 6 }, (_, index) => ({
        viewer: {
          repositories: {
            pageInfo: {
              hasNextPage: index < 5,
              endCursor: index < 5 ? `cursor-${index + 1}` : null,
            },
            nodes: [
              {
                nameWithOwner: `acme/repo-${index + 1}`,
                isPrivate: true,
                isArchived: false,
              },
            ],
          },
        },
      })),
    )

    const repos = await fetchAllViewerRepos('tok')

    expect(calls).toHaveLength(6)
    expect(repos.map((repo) => repo.nameWithOwner)).toEqual([
      'acme/repo-1',
      'acme/repo-2',
      'acme/repo-3',
      'acme/repo-4',
      'acme/repo-5',
      'acme/repo-6',
    ])
  })

  it('rejects an incomplete repository page that has no next cursor', async () => {
    mockGraphQL([
      {
        viewer: {
          repositories: {
            pageInfo: { hasNextPage: true, endCursor: null },
            nodes: [],
          },
        },
      },
    ])

    await expect(fetchAllViewerRepos('tok')).rejects.toThrow(
      'Repository pagination returned no cursor',
    )
  })
})

describe('fetchOrgMemberPage', () => {
  it('returns the first org page and a cursor carrying the org list', async () => {
    mockGraphQL([
      orgsResponse('acme', 'globex'),
      membersResponse([{ login: 'ada', name: 'Ada Lovelace' }]),
    ])

    const page = await fetchOrgMemberPage('tok', null)

    expect(page.members).toEqual([{ login: 'ada', name: 'Ada Lovelace', org: 'acme' }])
    expect(page.next).toEqual({ orgs: ['acme', 'globex'], index: 1, after: null })
  })

  it('stays on the same org while it has more members', async () => {
    mockGraphQL([
      orgsResponse('acme'),
      membersResponse([{ login: 'ada', name: null }], { hasNextPage: true, endCursor: 'c1' }),
    ])

    const page = await fetchOrgMemberPage('tok', null)

    expect(page.next).toEqual({ orgs: ['acme'], index: 0, after: 'c1' })
  })

  it('resumes from a cursor without re-listing the orgs', async () => {
    const calls = mockGraphQL([membersResponse([{ login: 'bo', name: null }])])
    const cursor: OrgMemberCursor = { orgs: ['acme', 'globex'], index: 1, after: 'c1' }

    const page = await fetchOrgMemberPage('tok', cursor)

    expect(calls).toHaveLength(1)
    expect(calls[0].variables).toMatchObject({ org: 'globex', after: 'c1' })
    expect(page.members).toEqual([{ login: 'bo', name: null, org: 'globex' }])
    expect(page.next).toBeNull()
  })

  it('skips an org whose members the token cannot read, and reports why', async () => {
    mockGraphQL([
      orgsResponse('locked', 'acme'),
      { errors: [{ message: 'Resource not accessible by personal access token' }] },
      membersResponse([{ login: 'ada', name: null }]),
    ])

    const page = await fetchOrgMemberPage('tok', null)

    expect(page.members).toEqual([{ login: 'ada', name: null, org: 'acme' }])
    expect(page.next).toBeNull()
    expect(page.skipped).toEqual([
      { org: 'locked', reason: 'Resource not accessible by personal access token' },
    ])
  })

  /**
   * The regression behind an empty picker with no explanation: an org the token
   * can't resolve comes back as HTTP 200 with `organization: null`, so without a
   * skipped entry it is indistinguishable from an org with no members.
   */
  it('reports an org that resolves to null rather than dropping it silently', async () => {
    mockGraphQL([
      orgsResponse('invisible'),
      { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Organization' }] },
    ])

    const page = await fetchOrgMemberPage('tok', null)

    expect(page.members).toEqual([])
    expect(page.skipped).toEqual([
      { org: 'invisible', reason: 'Could not resolve to an Organization' },
    ])
    expect(page.orgs).toEqual(['invisible'])
  })

  it('is empty when the account has no orgs', async () => {
    const calls = mockGraphQL([orgsResponse()])

    const page = await fetchOrgMemberPage('tok', null)

    expect(calls).toHaveLength(1)
    expect(page).toEqual({ members: [], next: null, orgs: [], skipped: [] })
  })

  it('propagates an expired token rather than walking every org', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 401 }))

    await expect(fetchOrgMemberPage('tok', null)).rejects.toThrow('Invalid or expired token')
  })
})
