/**
 * The dashboard's watch scope. Built automatically from the repositories the
 * signed-in session can see (src/state/automaticScope.ts) — nothing here is
 * user-edited or stored; the PAT/profile/watchlist era is gone.
 */
export interface WatchConfig {
  version: 1
  repos: string[] // "owner/name"
  users: string[] // GitHub logins
  staleDays: number
}
