import { useQuery } from '@tanstack/react-query'
import {
  fetchAllViewerRepos,
  fetchMergedPrs,
  fetchMyMergedPrs,
  fetchMyOpenPrs,
  fetchOpenPrs,
  fetchViewerLogin,
  GitHubError,
} from './github'
import type { ViewerRepo } from './github'
import type { WatchConfig } from '../storage/config'

/**
 * Short, non-reversible fingerprint of the token (FNV-1a). Every cache entry is
 * scoped by it so switching accounts never shows the previous account's data —
 * two accounts can legitimately watch the same repos — and so no part of the
 * token itself ends up in a query key.
 */
function accountKey(token: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 401 means the session is gone — retrying cannot fix it. 403 (secondary) and
 * 429 (primary, see graphql() in ./github) are GitHub rate limits — retrying
 * immediately replays the whole chunked fan-out and digs the hole deeper.
 */
const FATAL_STATUSES = new Set([401, 403, 429])

export function retryUnlessFatal(failureCount: number, error: Error): boolean {
  return (
    failureCount < 2 && !(error instanceof GitHubError && FATAL_STATUSES.has(error.status ?? 0))
  )
}

export function useOpenPrs(token: string, config: WatchConfig) {
  return useQuery({
    queryKey: ['openPrs', accountKey(token), config.repos, config.users],
    queryFn: () => fetchOpenPrs(token, config.repos, config.users),
    enabled: Boolean(token) && (config.repos.length > 0 || config.users.length > 0),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: retryUnlessFatal,
  })
}

export function useMergedPrs(token: string, config: WatchConfig, sinceIso: string) {
  return useQuery({
    queryKey: ['mergedPrs', accountKey(token), config.repos, config.users, sinceIso.slice(0, 10)],
    queryFn: () => fetchMergedPrs(token, config.repos, config.users, sinceIso),
    enabled: Boolean(token) && (config.repos.length > 0 || config.users.length > 0),
    staleTime: 10 * 60 * 1000,
    retry: retryUnlessFatal,
  })
}

/**
 * Your own open PRs, everywhere. The key carries no watchlist fingerprint —
 * unlike every other PR query here — because the underlying search ignores the
 * watchlist; folding `config` in would only throw the cache away on edits that
 * cannot change the result.
 *
 * `enabled` is a parameter rather than always-on because the top bar reads this
 * query for its freshness and quota readout, and must not trigger the fetch on
 * the pages that don't show it.
 */
export function useMyOpenPrs(token: string, enabled = true) {
  return useQuery({
    queryKey: ['myOpenPrs', accountKey(token)],
    queryFn: () => fetchMyOpenPrs(token),
    enabled: Boolean(token) && enabled,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: retryUnlessFatal,
  })
}

/** Your own merged PRs since `sinceIso`. Unscoped, for the Mine view's toggle. */
export function useMyMergedPrs(token: string, sinceIso: string, enabled = true) {
  return useQuery({
    queryKey: ['myMergedPrs', accountKey(token), sinceIso.slice(0, 10)],
    queryFn: () => fetchMyMergedPrs(token, sinceIso),
    enabled: Boolean(token) && enabled,
    staleTime: 10 * 60 * 1000,
    retry: retryUnlessFatal,
  })
}

export function useViewer(token: string) {
  return useQuery({
    queryKey: ['viewer', accountKey(token)],
    queryFn: () => fetchViewerLogin(token),
    enabled: Boolean(token),
    staleTime: Infinity,
    retry: false,
  })
}

export interface ViewerReposResult {
  repos: ViewerRepo[]
  /** True until the repository connection has loaded (bounded walk). */
  isLoading: boolean
  /** The walk hit its page cap; scope covers the most recently pushed repos only. */
  isTruncated: boolean
  error: Error | null
}

/**
 * Every repository visible to the session, up to the bounded walk's cap. The
 * query is persisted to disk (see storage/queryCache.ts) so a reload paints the
 * dashboard from the cached scope instead of gating on the serial cursor walk.
 */
export function useViewerRepos(token: string): ViewerReposResult {
  const { data, error, isLoading } = useQuery({
    queryKey: ['viewerRepos', accountKey(token)],
    queryFn: () => fetchAllViewerRepos(token),
    enabled: Boolean(token),
    staleTime: 10 * 60 * 1000,
    retry: retryUnlessFatal,
  })

  return {
    repos: data?.repos ?? [],
    isLoading,
    isTruncated: data?.truncated ?? false,
    error,
  }
}
