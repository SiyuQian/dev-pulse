import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useViewerRepos } from '../api/queries'
import { fetchSession } from '../api/session'
import { clearSessionData } from '../storage/securityMigration'
import type { WatchConfig } from '../storage/config'
import { automaticConfig } from './automaticScope'

interface AppState {
  /** A non-secret cache identity. GitHub credentials stay in the HttpOnly session cookie. */
  token: string
  /** The signed-in GitHub login. */
  login: string
  config: WatchConfig
  /** The repo walk hit its cap; scope covers the most recently pushed repos only. */
  scopeTruncated: boolean
}

const AppStateContext = createContext<AppState | null>(null)

function AccessScreen({ loading, error }: { loading: boolean; error?: string }) {
  const forbidden = new URLSearchParams(window.location.search).get('auth') === 'forbidden'
  return (
    <main className="access-screen">
      <section className="access-card">
        <div className="access-mark" aria-hidden="true" />
        <p className="eyebrow">DEV·PULSE</p>
        <h1>{loading ? 'Loading your workspace…' : 'Your PR dashboard, ready on sign-in.'}</h1>
        <p>
          {loading
            ? 'Discovering your GitHub session and active repositories.'
            : forbidden
              ? 'This GitHub account is not on the dashboard allowlist.'
              : (error ?? 'Sign in once. No PATs, repository lists, or local setup required.')}
        </p>
        {!loading && (
          <a className="primary access-login" href="/api/auth/login">
            Sign in with GitHub
          </a>
        )}
      </section>
    </main>
  )
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: ['authSession'],
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // A 401 from the GraphQL proxy (src/api/github.ts) means the session died
  // mid-use: re-check it so the sign-in screen replaces the broken board.
  useEffect(() => {
    const recheck = () => void queryClient.invalidateQueries({ queryKey: ['authSession'] })
    window.addEventListener('devpulse:unauthorized', recheck)
    return () => window.removeEventListener('devpulse:unauthorized', recheck)
  }, [queryClient])

  // No session (expired, revoked, or never signed in): the persisted repo roster
  // and PR data must not outlive it on disk.
  const signedOut = session.isSuccess && session.data === null
  useEffect(() => {
    if (signedOut) clearSessionData(queryClient)
  }, [queryClient, signedOut])

  const token = session.data ? `session:${session.data.login}` : ''
  const login = session.data?.login ?? ''
  const repositories = useViewerRepos(token)
  const config = useMemo(() => automaticConfig(repositories.repos), [repositories.repos])

  const value = useMemo<AppState>(
    () => ({ token, login, config, scopeTruncated: repositories.isTruncated }),
    [config, login, repositories.isTruncated, token],
  )

  if (session.isPending) return <AccessScreen loading />
  if (session.error)
    return <AccessScreen loading={false} error="The authentication service is unavailable." />
  if (!session.data) return <AccessScreen loading={false} />
  if (repositories.error && repositories.repos.length === 0) {
    return (
      <AccessScreen
        loading={false}
        error={`Could not discover GitHub repositories: ${repositories.error.message}`}
      />
    )
  }
  // The viewerRepos query is persisted, so a reload usually restores the scope
  // instantly and only a genuinely empty cache waits on the network walk.
  if (repositories.isLoading && repositories.repos.length === 0) return <AccessScreen loading />

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

// Context and provider intentionally share this module so consumers import one stable API.
// oxlint-disable-next-line react/only-export-components
export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
