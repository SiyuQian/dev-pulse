import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { removeOldestQuery, type Persister } from '@tanstack/react-query-persist-client'

const QUERY_CACHE_KEY = 'devpulse:query-cache:v1'

/**
 * Bump when the shape of a persisted query's data *or key* changes. Restore is
 * all-or-nothing, so a cache written by an older shape must be discarded rather
 * than hydrated — same reasoning as the `version` field on the profile store.
 *
 * v2: query keys gained the account fingerprint at index 1, so v1 entries can
 * never match a key the hooks ask for. The storage key itself stays at v1 on
 * purpose — a buster mismatch calls removeClient(), whereas renaming the key
 * would orphan the old blob with nothing left to clean it up.
 */
const QUERY_CACHE_BUSTER = 'v2'

/** Yesterday's board is worth painting for a second; last week's is just misleading. */
const QUERY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000

/**
 * An allowlist, deliberately, not a denylist: only the two queries that gate
 * first paint go to disk. A persisted cache blob is exactly the kind of thing
 * that ends up pasted into a bug report, so anything added later stays off disk
 * until someone has checked what it carries — the conservative default the
 * "PAT never appears in exports or error reports" invariant asks for.
 *
 * Query keys are safe on their own account: they hold `accountKey(token)`, a
 * non-reversible FNV-1a fingerprint (src/api/queries.ts), not token material.
 * It also scopes every entry per account, so two accounts watching the same
 * repos restore their own board rather than each other's.
 */
const PERSISTED_QUERIES = new Set(['openPrs', 'mergedPrs'])

/** Structurally typed rather than `Query`, so tests can pass a two-field stub. */
export interface PersistableQuery {
  queryKey: readonly unknown[]
  state: { data?: unknown }
}

/**
 * Gated on `data`, not on `status === 'success'` (the library default). The
 * persister rewrites the whole blob on every cache change, so excluding errored
 * queries would mean one failed refetch *deletes* the rows we just restored —
 * blanking the board on the second offline reload. Keeping the last known data
 * is the supported pattern: hydrate() explicitly handles failed queries that
 * carry data from an earlier successful fetch.
 */
export function shouldPersistQuery(query: PersistableQuery): boolean {
  return query.state.data !== undefined && PERSISTED_QUERIES.has(String(query.queryKey[0]))
}

export function createQueryCachePersister(): Persister {
  return createAsyncStoragePersister({
    key: QUERY_CACHE_KEY,
    // Can be null in some Android WebViews, and absent outside the browser.
    storage: typeof window === 'undefined' ? undefined : window.localStorage,
    throttleTime: 1000,
    // localStorage is a shared ~5MB budget: shed old queries instead of throwing.
    retry: removeOldestQuery,
  })
}

export const queryCachePersistOptions = {
  buster: QUERY_CACHE_BUSTER,
  maxAge: QUERY_CACHE_MAX_AGE,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
}
