import { useOpenPrs } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import { AccountSwitcher } from './AccountSwitcher'
import { scopeSummary } from '../shared/format'

/**
 * Watchlist scope, identity, and the two operational facts that matter when
 * this sits open all day: how fresh the data is, and how much quota is left.
 * The wordmark lives in the rail, so it is deliberately absent here.
 */
export function TopBar() {
  const { token, config } = useAppState()
  const { data, isFetching, refetch, dataUpdatedAt, error } = useOpenPrs(token, config)

  // Pages keep rendering cached rows when a refetch fails, so the freshness
  // indicator is the one place that has to admit the data is no longer live.
  // A rehydrated error survives JSON as a bare object, hence the fallback.
  const staleError = data && error ? error.message || 'could not reach GitHub' : null
  const updatedAt = new Date(dataUpdatedAt)
  const updatedLabel = updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const rate = data?.rateLimit
  const quotaRatio = rate && rate.limit > 0 ? rate.remaining / rate.limit : null
  const scope = scopeSummary(config.repos, config.users)

  return (
    <header className="top">
      <AccountSwitcher />
      {scope && <span className="crumbs">{scope}</span>}

      <span className="top-spacer" />

      {dataUpdatedAt > 0 && (
        <span
          className="freshness"
          title={staleError ? `Last refresh failed: ${staleError}` : updatedAt.toLocaleTimeString()}
        >
          <i className={`pulse${isFetching ? ' busy' : staleError ? ' stale' : ''}`} />
          {isFetching
            ? 'syncing'
            : staleError
              ? `stale · ${updatedLabel}`
              : `updated ${updatedLabel}`}
        </span>
      )}

      {rate && rate.limit > 0 && (
        <span className="quota" title={`Resets ${new Date(rate.resetAt).toLocaleTimeString()}`}>
          {rate.remaining.toLocaleString()}/{rate.limit.toLocaleString()}
          <span className="bar">
            <i
              style={{
                width: `${(quotaRatio ?? 0) * 100}%`,
                background: (quotaRatio ?? 1) < 0.15 ? 'var(--bad)' : 'var(--blue)',
              }}
            />
          </span>
        </span>
      )}

      <button className="secondary" onClick={() => refetch()} disabled={isFetching || !token}>
        {isFetching ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>
  )
}
