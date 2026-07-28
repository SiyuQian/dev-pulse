import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { fetchMergedPrs, fetchOpenPrs, fetchViewerLogin, fetchViewerRepoPage, GitHubError } from './github'
import type { ViewerRepo } from './github'
import type { WatchConfig } from '../storage/config'

export function useOpenPrs(token: string, config: WatchConfig) {
  return useQuery({
    queryKey: ['openPrs', config.repos, config.users],
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
    queryKey: ['mergedPrs', config.repos, config.users, sinceIso.slice(0, 10)],
    queryFn: () => fetchMergedPrs(token, config.repos, config.users, sinceIso),
    enabled: Boolean(token) && (config.repos.length > 0 || config.users.length > 0),
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
  })
}

export function useViewer(token: string) {
  return useQuery({
    queryKey: ['viewer', token.slice(-8)],
    queryFn: () => fetchViewerLogin(token),
    enabled: Boolean(token),
    staleTime: Infinity,
    retry: false,
  })
}

/** Keeps a large account's repo walk bounded — 100 repos per page. */
const VIEWER_REPO_PAGE_LIMIT = 5

export interface ViewerReposResult {
  repos: ViewerRepo[]
  /** True only until the *first* page lands — later pages arrive silently. */
  isLoading: boolean
  isBackfilling: boolean
  error: Error | null
}

/**
 * Repos for the Settings picker. The first page resolves in one round trip and
 * renders immediately; remaining pages are fetched in the background so the
 * picker is never gated on a serial cursor walk.
 */
export function useViewerRepos(token: string): ViewerReposResult {
  const { data, error, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['viewerRepos', token.slice(-8)],
    queryFn: ({ pageParam }) => fetchViewerRepoPage(token, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last, pages) =>
      pages.length >= VIEWER_REPO_PAGE_LIMIT ? undefined : last.nextCursor,
    enabled: Boolean(token),
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
  })

  // Drive the backfill from the hook rather than the picker, so every consumer
  // gets the full list without having to know about pagination.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const repos = useMemo(() => data?.pages.flatMap((page) => page.repos) ?? [], [data])

  return { repos, isLoading, isBackfilling: isFetchingNextPage, error }
}
