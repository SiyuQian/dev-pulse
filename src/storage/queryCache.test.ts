import { describe, expect, it } from 'vitest'
import { shouldPersistQuery, type PersistableQuery } from './queryCache'

function query(queryKey: unknown[], data: unknown = { prs: [] }): PersistableQuery {
  return { queryKey, state: { data } }
}

// Keys carry accountKey(token) at index 1 — a fingerprint, never token material.
const ACCOUNT = '1jq4x7'

describe('shouldPersistQuery', () => {
  it('persists the queries that gate first paint', () => {
    expect(shouldPersistQuery(query(['openPrs', ACCOUNT, ['a/b'], []]))).toBe(true)
    expect(shouldPersistQuery(query(['mergedPrs', ACCOUNT, ['a/b'], [], '2026-07-01']))).toBe(true)
    // The repo roster gates first paint too: the shell waits on it for scope.
    expect(shouldPersistQuery(query(['viewerRepos', ACCOUNT]))).toBe(true)
  })

  // Identity is cheap to refetch and has no first-paint value, so it stays out
  // of a blob that can end up in a bug report.
  it('keeps identity queries off disk', () => {
    expect(shouldPersistQuery(query(['viewer', ACCOUNT]))).toBe(false)
  })

  it('does not persist queries added later without review', () => {
    expect(shouldPersistQuery(query(['someNewQuery', ACCOUNT]))).toBe(false)
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
