import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import {
  fetchMergedPrs,
  fetchMyMergedPrs,
  fetchMyOpenPrs,
  fetchOpenPrs,
  fetchOrgMemberPage,
  fetchViewerLogin,
  fetchViewerRepoPage,
  GitHubError,
} from './github'
import type { OrgMember, OrgMemberCursor, SkippedOrg, ViewerRepo } from './github'
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
 * Drops every cache entry scoped to a token. Removing an account deletes its
 * PAT, so its board can never be refetched or invalidated again — and because
 * the cache is persisted, its PRs would otherwise sit in localStorage until
 * maxAge. Lives here because the fingerprint's position in the key does.
 */
export function removeAccountQueries(client: QueryClient, token: string): void {
  if (!token) return
  const key = accountKey(token)
  client.removeQueries({ predicate: (query) => query.queryKey[1] === key })
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
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof GitHubError && error.status === 401),
  })
}

/** Your own merged PRs since `sinceIso`. Unscoped, for the Mine view's toggle. */
export function useMyMergedPrs(token: string, sinceIso: string, enabled = true) {
  return useQuery({
    queryKey: ['myMergedPrs', accountKey(token), sinceIso.slice(0, 10)],
    queryFn: () => fetchMyMergedPrs(token, sinceIso),
    enabled: Boolean(token) && enabled,
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
  const { data, error, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['viewerRepos', accountKey(token)],
      queryFn: ({ pageParam }) => fetchViewerRepoPage(token, pageParam),
      initialPageParam: null as string | null,
      getNextPageParam: (last, pages) =>
        pages.length >= VIEWER_REPO_PAGE_LIMIT ? undefined : last.nextCursor,
      enabled: Boolean(token),
      staleTime: 10 * 60 * 1000,
      // Named `cause` rather than `error`: this hook destructures an outer
      // `error` above, and shadowing it trips no-shadow.
      retry: (failureCount, cause) =>
        failureCount < 2 && !(cause instanceof GitHubError && cause.status === 401),
    })

  // Drive the backfill from the hook rather than the picker, so every consumer
  // gets the full list without having to know about pagination.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const repos = useMemo(() => data?.pages.flatMap((page) => page.repos) ?? [], [data])

  return { repos, isLoading, isBackfilling: isFetchingNextPage, error }
}

/**
 * 100 members per page. Twenty pages because real enterprise orgs run into the
 * thousands and `membersWithRole` has no server-side search (checked against the
 * live schema — only cursor args), so the only way to make a teammate findable
 * is to have walked far enough to have them. The walk is one cheap request per
 * page and the result is cached for 30 minutes.
 */
const ORG_MEMBER_PAGE_LIMIT = 20

export interface OrgMembersResult {
  members: OrgMember[]
  /** True only until the *first* page lands — later pages arrive silently. */
  isLoading: boolean
  isBackfilling: boolean
  error: Error | null
  /** Orgs the token could see but whose member list it couldn't read. */
  skipped: SkippedOrg[]
  /** How many orgs the token reports at all. Zero is its own diagnosis. */
  orgCount: number
  /** The org is bigger than the page cap — the list is real but incomplete. */
  isTruncated: boolean
}

/**
 * Teammates from the viewer's orgs, for the people picker in Settings. Same
 * shape as useViewerRepos: page one renders, the rest backfills behind it.
 *
 * Errors are the picker's normal case, not an exception — a token without org
 * read access simply yields nothing and the picker falls back to typing a
 * login by hand.
 */
export function useOrgMembers(token: string): OrgMembersResult {
  const { data, error, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['orgMembers', accountKey(token)],
      queryFn: ({ pageParam }) => fetchOrgMemberPage(token, pageParam),
      initialPageParam: null as OrgMemberCursor | null,
      getNextPageParam: (last, pages) =>
        pages.length >= ORG_MEMBER_PAGE_LIMIT ? undefined : last.next,
      enabled: Boolean(token),
      staleTime: 30 * 60 * 1000,
      retry: (failureCount, cause) =>
        failureCount < 2 && !(cause instanceof GitHubError && cause.status === 401),
    })

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // One person can be in two watched orgs; the picker should list them once.
  const members = useMemo(() => {
    const byLogin = new Map<string, OrgMember>()
    for (const page of data?.pages ?? []) {
      for (const member of page.members)
        if (!byLogin.has(member.login)) byLogin.set(member.login, member)
    }
    // Named accounts first. Big orgs are full of bots and SCIM-provisioned
    // service accounts whose login is a hex blob and whose name is null; sorting
    // by login alone puts those at the very top and buries every actual person.
    return [...byLogin.values()].sort((a, b) => {
      if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1
      return (a.name ?? a.login).localeCompare(b.name ?? b.login)
    })
  }, [data])

  const pages = data?.pages ?? []
  const last = pages.at(-1)

  return {
    members,
    isLoading,
    isBackfilling: isFetchingNextPage,
    error,
    skipped: pages.flatMap((page) => page.skipped),
    orgCount: last?.orgs.length ?? 0,
    isTruncated: pages.length >= ORG_MEMBER_PAGE_LIMIT && Boolean(last?.next),
  }
}
