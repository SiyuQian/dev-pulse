import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { loadConfig, loadToken, saveConfig, saveToken, type WatchConfig } from '../storage/config'

interface AppState {
  token: string
  setToken: (token: string) => void
  config: WatchConfig
  setConfig: (config: WatchConfig) => void
}

const AppStateContext = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(loadToken)
  const [config, setConfigState] = useState(loadConfig)

  const setToken = useCallback((next: string) => {
    saveToken(next)
    setTokenState(next)
  }, [])

  const setConfig = useCallback((next: WatchConfig) => {
    saveConfig(next)
    setConfigState(next)
  }, [])

  const value = useMemo(
    () => ({ token, setToken, config, setConfig }),
    [token, setToken, config, setConfig],
  )
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
