import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useViewerRepos } from '../api/queries'
import { fetchSession } from '../api/session'
import type { WatchConfig } from '../storage/config'
import { automaticConfig } from './automaticScope'

export interface Account {
  id: string
  label: string
  login?: string
  hasToken: boolean
  config: WatchConfig
}

interface AppState {
  /** A non-secret cache identity. GitHub credentials stay in the HttpOnly session cookie. */
  token: string
  setToken: (token: string) => void
  config: WatchConfig
  setConfig: (config: WatchConfig) => void
  accounts: Account[]
  activeId: string
  switchAccount: (id: string) => void
  addAccount: (config?: WatchConfig) => string
  renameAccount: (id: string, label: string) => void
  removeAccount: (id: string) => void
  noteLogin: (login: string) => void
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
  const session = useQuery({
    queryKey: ['authSession'],
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const token = session.data ? `session:${session.data.login}` : ''
  const repositories = useViewerRepos(token)
  const config = useMemo(() => automaticConfig(repositories.repos), [repositories.repos])

  const noOp = useCallback(() => {}, [])
  const addAccount = useCallback(() => 'github-session', [])

  const value = useMemo<AppState>(() => {
    const login = session.data?.login
    const account: Account = {
      id: 'github-session',
      label: login ?? 'GitHub',
      login,
      hasToken: true,
      config,
    }
    return {
      token,
      setToken: noOp,
      config,
      setConfig: noOp,
      accounts: [account],
      activeId: account.id,
      switchAccount: noOp,
      addAccount,
      renameAccount: noOp,
      removeAccount: noOp,
      noteLogin: noOp,
    }
  }, [addAccount, config, noOp, session.data?.login, token])

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
  if (repositories.isLoading) return <AccessScreen loading />

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

// Context and provider intentionally share this module so consumers import one stable API.
// oxlint-disable-next-line react/only-export-components
export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
