import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMergedPrs } from '../../api/queries'
import { useAppState } from '../../state/AppState'

const RANGE_DAYS = 28

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString()
}

function formatHours(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export function StatsPage() {
  const { token, config } = useAppState()
  // Stable per mount so the query key doesn't churn.
  const [now] = useState(() => Date.now())
  const since = useMemo(() => isoDaysAgo(RANGE_DAYS, now), [now])
  const { data: merged, isPending, error } = useMergedPrs(token, config, since)

  if (!token) {
    return <p className="empty">No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.</p>
  }
  if (error) return <p className="empty error">Failed to load stats: {error.message}</p>
  if (isPending) return <p className="empty">Loading merge history…</p>
  if (merged.length === 0) {
    return <p className="empty">No PRs merged in the last {RANGE_DAYS} days for the watched repos/people.</p>
  }

  // Weekly buckets, oldest first
  const weeks = [3, 2, 1, 0].map((weeksAgo) => {
    const end = now - weeksAgo * 7 * 86_400_000
    const start = end - 7 * 86_400_000
    const inWeek = merged.filter((pr) => {
      const t = new Date(pr.mergedAt).getTime()
      return t > start && t <= end
    })
    return { label: `${new Date(start).getMonth() + 1}/${new Date(start).getDate()}`, count: inWeek.length }
  })
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count))

  const cycleTimes = merged.map((pr) => pr.cycleTimeHours).sort((a, b) => a - b)
  const median = cycleTimes[Math.floor(cycleTimes.length / 2)]
  const p90 = cycleTimes[Math.min(cycleTimes.length - 1, Math.floor(cycleTimes.length * 0.9))]

  const byAuthor = new Map<string, { count: number; additions: number; deletions: number }>()
  for (const pr of merged) {
    const entry = byAuthor.get(pr.author) ?? { count: 0, additions: 0, deletions: 0 }
    entry.count += 1
    entry.additions += pr.additions
    entry.deletions += pr.deletions
    byAuthor.set(pr.author, entry)
  }
  const authors = [...byAuthor.entries()].sort((a, b) => b[1].count - a[1].count)

  return (
    <div className="stats-page">
      <div className="stat-tiles">
        <div className="tile"><strong>{merged.length}</strong><span>merged / {RANGE_DAYS}d</span></div>
        <div className="tile"><strong>{(merged.length / 4).toFixed(1)}</strong><span>merges / week</span></div>
        <div className="tile"><strong>{formatHours(median)}</strong><span>median cycle time</span></div>
        <div className="tile"><strong>{formatHours(p90)}</strong><span>p90 cycle time</span></div>
      </div>

      <section>
        <h3>Merges per week</h3>
        <div className="bar-chart" role="img" aria-label="Merges per week over the last 4 weeks">
          {weeks.map((week) => (
            <div className="bar-col" key={week.label}>
              <span className="bar-value">{week.count}</span>
              <div className="bar" style={{ height: `${(week.count / maxWeek) * 100}%` }} />
              <span className="bar-label">wk of {week.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Throughput by author</h3>
        <table className="pr-table narrow">
          <thead><tr><th>Author</th><th>Merged</th><th>Lines</th></tr></thead>
          <tbody>
            {authors.map(([author, s]) => (
              <tr key={author}>
                <td>{author}</td>
                <td>{s.count}</td>
                <td><span className="add">+{s.additions}</span> <span className="del">−{s.deletions}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Recently merged</h3>
        <ul className="pr-list">
          {merged.slice(0, 15).map((pr) => (
            <li key={pr.id}>
              <a href={pr.url} target="_blank" rel="noreferrer">
                <span className="col-repo">{pr.repo}</span> #{pr.number} {pr.title}
              </a>
              <span className="pr-list-meta">by {pr.author} · cycle {formatHours(pr.cycleTimeHours)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
