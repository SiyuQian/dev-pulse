import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'

/**
 * Identity, watchlist scope, and the two operational facts that matter when
 * this sits open all day: how fresh the data is, and how much quota is left.
 */
export function TopBar() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const { data, isFetching, refetch, dataUpdatedAt } = useOpenPrs(token, config)

  const rate = data?.rateLimit
  const quotaRatio = rate && rate.limit > 0 ? rate.remaining / rate.limit : null
  const scope = [
    config.repos.length > 0 ? `${config.repos.length} repo${config.repos.length === 1 ? '' : 's'}` : null,
    config.users.length > 0 ? `${config.users.length} ${config.users.length === 1 ? 'person' : 'people'}` : null,
  ].filter(Boolean)

  return (
    <header className="top">
      <h1>
        <b>dev</b>·pulse
      </h1>
      {scope.length > 0 && <span className="crumbs">{scope.join(' · ')}</span>}
      {viewer && <span className="crumbs">@{viewer}</span>}

      <span className="top-spacer" />

      {dataUpdatedAt > 0 && (
        <span className="freshness" title={new Date(dataUpdatedAt).toLocaleTimeString()}>
          <i className={`pulse${isFetching ? ' busy' : ''}`} />
          {isFetching ? 'syncing' : `updated ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
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
