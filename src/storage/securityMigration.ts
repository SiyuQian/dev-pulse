import type { QueryClient } from '@tanstack/react-query'
import { QUERY_CACHE_KEY } from './queryCache'

const LEGACY_TOKEN_KEYS = ['devpulse:tokens:v2', 'devpulse:token:v1'] as const
const OAUTH_MIGRATION_KEY = 'devpulse:oauth-security-migration:v1'

export interface ClientStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Removes browser data that can contain credentials or private repository details. */
export function clearPrivateClientData(storage: ClientStorage = window.localStorage): boolean {
  let complete = true
  for (const key of [...LEGACY_TOKEN_KEYS, QUERY_CACHE_KEY]) {
    try {
      storage.removeItem(key)
    } catch {
      complete = false
      // If browser storage is unavailable, no readable local data can be cleared here.
    }
  }
  return complete
}

/**
 * Session-loss cleanup. The persister rewrites its blob from the in-memory cache,
 * so private queries must leave memory as well as localStorage. `authSession`
 * stays: the provider observes it, and removing it would refetch in a loop.
 */
export function clearSessionData(queryClient: QueryClient, storage?: ClientStorage): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'authSession' })
  clearPrivateClientData(storage)
}

/** One-time cleanup when upgrading a browser from the PAT-based application. */
export function runOAuthSecurityMigration(storage: ClientStorage = window.localStorage): void {
  try {
    if (storage.getItem(OAUTH_MIGRATION_KEY) === 'complete') return
    if (!clearPrivateClientData(storage)) return
    storage.setItem(OAUTH_MIGRATION_KEY, 'complete')
  } catch {
    // Retry on the next startup rather than marking an incomplete migration done.
  }
}
