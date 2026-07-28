import { describe, expect, it } from 'vitest'
import { shouldPersistQuery, type PersistableQuery } from './queryCache'

function query(queryKey: unknown[], data: unknown = { prs: [] }): PersistableQuery {
  return { queryKey, state: { data } }
}

describe('shouldPersistQuery', () => {
  it('persists the PR queries that gate first paint', () => {
    expect(shouldPersistQuery(query(['openPrs', ['a/b'], []]))).toBe(true)
    expect(shouldPersistQuery(query(['mergedPrs', ['a/b'], [], '2026-07-01']))).toBe(true)
  })

  // These are keyed on token.slice(-8); a persisted cache blob must never carry
  // any part of the PAT, since it can end up in an export or a bug report.
  it('never persists token-derived query keys', () => {
    expect(shouldPersistQuery(query(['viewer', 'ecret123']))).toBe(false)
    expect(shouldPersistQuery(query(['viewerRepos', 'ecret123']))).toBe(false)
  })

  it('does not persist queries added later without review', () => {
    expect(shouldPersistQuery(query(['someNewQuery']))).toBe(false)
  })

  it('does not persist a query that has never resolved', () => {
    expect(shouldPersistQuery({ queryKey: ['openPrs'], state: {} })).toBe(false)
  })

  // Otherwise one failed refetch rewrites the blob without the rows we just
  // restored, blanking the board on the next offline reload.
  it('keeps the last known data when a refetch has failed', () => {
    expect(shouldPersistQuery({ queryKey: ['openPrs'], state: { data: { prs: [] } } })).toBe(true)
  })
})
