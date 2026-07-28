import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  createProfile,
  defaultConfig,
  loadProfiles,
  loadTokens,
  nextAccountLabel,
  saveProfiles,
  saveTokens,
  type Profile,
  type ProfileStore,
  type WatchConfig,
} from '../storage/config'

/** A profile as the UI needs it — never carries the token itself. */
export interface Account {
  id: string
  label: string
  login?: string
  hasToken: boolean
  config: WatchConfig
}

interface AppState {
  /** Active account's token. Everything that talks to GitHub uses this. */
  token: string
  setToken: (token: string) => void
  /** Active account's watchlist. */
  config: WatchConfig
  setConfig: (config: WatchConfig) => void

  accounts: Account[]
  activeId: string
  switchAccount: (id: string) => void
  /** Adds an empty account, makes it active, and returns its id. */
  addAccount: (config?: WatchConfig) => string
  renameAccount: (id: string, label: string) => void
  removeAccount: (id: string) => void
  /** Caches the login a token resolved to, so the switcher can label every account. */
  noteLogin: (login: string) => void
}

const AppStateContext = createContext<AppState | null>(null)

function activeProfile(store: ProfileStore): Profile {
  return store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0]
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState(loadProfiles)
  const [tokens, setTokens] = useState(loadTokens)

  const commitStore = useCallback((next: ProfileStore) => {
    saveProfiles(next)
    setStore(next)
  }, [])

  const commitTokens = useCallback((next: Record<string, string>) => {
    saveTokens(next)
    setTokens(next)
  }, [])

  const active = activeProfile(store)
  const activeId = active.id

  const patchActive = useCallback(
    (patch: (profile: Profile) => Profile) => {
      setStore((prev) => {
        const next: ProfileStore = {
          ...prev,
          profiles: prev.profiles.map((p) => (p.id === prev.activeId ? patch(p) : p)),
        }
        saveProfiles(next)
        return next
      })
    },
    [],
  )

  const setToken = useCallback(
    (next: string) => {
      const trimmed = next.trim()
      commitTokens({ ...tokens, [activeId]: trimmed })
      // A cleared or replaced token invalidates the cached identity.
      if (!trimmed) patchActive(({ login: _login, ...rest }) => rest)
    },
    [activeId, commitTokens, patchActive, tokens],
  )

  const setConfig = useCallback(
    (config: WatchConfig) => patchActive((profile) => ({ ...profile, config })),
    [patchActive],
  )

  const noteLogin = useCallback(
    (login: string) => patchActive((profile) => (profile.login === login ? profile : { ...profile, login })),
    [patchActive],
  )

  const switchAccount = useCallback(
    (id: string) => {
      setStore((prev) => {
        if (!prev.profiles.some((p) => p.id === id) || prev.activeId === id) return prev
        const next = { ...prev, activeId: id }
        saveProfiles(next)
        return next
      })
    },
    [],
  )

  const addAccount = useCallback(
    (config: WatchConfig = defaultConfig) => {
      const profile = createProfile(nextAccountLabel(store.profiles), config)
      commitStore({ ...store, activeId: profile.id, profiles: [...store.profiles, profile] })
      return profile.id
    },
    [commitStore, store],
  )

  const renameAccount = useCallback(
    (id: string, label: string) => {
      setStore((prev) => {
        const next = {
          ...prev,
          profiles: prev.profiles.map((p) => (p.id === id ? { ...p, label: label.trim() || p.label } : p)),
        }
        saveProfiles(next)
        return next
      })
    },
    [],
  )

  const removeAccount = useCallback(
    (id: string) => {
      const remaining = store.profiles.filter((p) => p.id !== id)
      // Always keep one account around, so there is somewhere to paste a token.
      const profiles = remaining.length > 0 ? remaining : [createProfile('Account 1')]
      const nextActive = profiles.some((p) => p.id === store.activeId) ? store.activeId : profiles[0].id
      commitStore({ version: 2, activeId: nextActive, profiles })
      const { [id]: _removed, ...rest } = tokens
      commitTokens(rest)
    },
    [commitStore, commitTokens, store, tokens],
  )

  const accounts = useMemo(
    () =>
      store.profiles.map<Account>((p) => ({
        id: p.id,
        label: p.label,
        login: p.login,
        hasToken: Boolean(tokens[p.id]),
        config: p.config,
      })),
    [store.profiles, tokens],
  )

  const value = useMemo(
    () => ({
      token: tokens[activeId] ?? '',
      setToken,
      config: active.config,
      setConfig,
      accounts,
      activeId,
      switchAccount,
      addAccount,
      renameAccount,
      removeAccount,
      noteLogin,
    }),
    [
      accounts, active.config, activeId, addAccount, noteLogin, removeAccount, renameAccount,
      setConfig, setToken, switchAccount, tokens,
    ],
  )
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
