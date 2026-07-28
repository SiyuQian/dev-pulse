import { useQuery } from '@tanstack/react-query'
import { fetchMergedPrs, fetchOpenPrs, fetchViewerLogin, fetchViewerRepos, GitHubError } from './github'
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

export function useOpenPrs(token: string, config: WatchConfig) {
  return useQuery({
    queryKey: ['openPrs', accountKey(token), config.repos, config.users],
    queryFn: () => fetchOpenPrs(token, config.repos, config.users),
    enabled: Boolean(token) && (config.repos.length > 0 || config.users.length > 0),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
  })
}

export function useMergedPrs(token: string, config: WatchConfig, sinceIso: string) {
  return useQuery({
    queryKey: ['mergedPrs', accountKey(token), config.repos, config.users, sinceIso.slice(0, 10)],
    queryFn: () => fetchMergedPrs(token, config.repos, config.users, sinceIso),
    enabled: Boolean(token) && (config.repos.length > 0 || config.users.length > 0),
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
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

export function useViewerRepos(token: string) {
  return useQuery({
    queryKey: ['viewerRepos', accountKey(token)],
    queryFn: () => fetchViewerRepos(token),
    enabled: Boolean(token),
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
  })
}
