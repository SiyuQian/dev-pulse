import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOrgMemberPage, type OrgMemberCursor } from './github'

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

  it('skips an org whose members the token cannot read', async () => {
    mockGraphQL([
      orgsResponse('locked', 'acme'),
      { errors: [{ message: 'Resource not accessible by personal access token' }] },
      membersResponse([{ login: 'ada', name: null }]),
    ])

    const page = await fetchOrgMemberPage('tok', null)

    expect(page.members).toEqual([{ login: 'ada', name: null, org: 'acme' }])
    expect(page.next).toBeNull()
  })

  it('is empty when the account has no orgs', async () => {
    const calls = mockGraphQL([orgsResponse()])

    const page = await fetchOrgMemberPage('tok', null)

    expect(calls).toHaveLength(1)
    expect(page).toEqual({ members: [], next: null })
  })

  it('propagates an expired token rather than walking every org', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 401 }))

    await expect(fetchOrgMemberPage('tok', null)).rejects.toThrow('Invalid or expired token')
  })
})
