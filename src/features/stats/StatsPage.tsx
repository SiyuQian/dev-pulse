import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMergedPrs } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import { Avatar, Panel, Queue, QueueRow } from '../shared/ui'
import { formatHours } from '../shared/format'

const RANGE_DAYS = 28

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString()
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
    return <p className="empty">No PRs merged in the last {RANGE_DAYS} days for the watched repos and people.</p>
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
  const trend = weeks[3].count - weeks[2].count

  const cycleTimes = merged.map((pr) => pr.cycleTimeHours).sort((a, b) => a - b)
  const medianCycle = cycleTimes[Math.floor(cycleTimes.length / 2)]
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
  const maxAuthor = Math.max(1, ...authors.map(([, s]) => s.count))

  return (
    <div className="fade-in">
      <div className="page-head">
        <h2>Trends</h2>
        <p>Merged pull requests over the last {RANGE_DAYS} days</p>
      </div>

      <div className="stat-tiles">
        <div className="tile"><strong>{merged.length}</strong><span>merged</span></div>
        <div className="tile"><strong>{(merged.length / 4).toFixed(1)}</strong><span>per week</span></div>
        <div className="tile"><strong>{formatHours(medianCycle)}</strong><span>median cycle time</span></div>
        <div className="tile"><strong>{formatHours(p90)}</strong><span>p90 cycle time</span></div>
      </div>

      <div className="two-col">
        <div>
          <Panel
            title="Merges per week"
            hue="var(--stage-approved)"
            note={trend === 0 ? 'flat against last week' : `${trend > 0 ? '+' : ''}${trend} against last week`}
          >
            <div className="bar-chart" role="img" aria-label={`Merges per week: ${weeks.map((w) => `${w.count} in week of ${w.label}`).join(', ')}`}>
              {weeks.map((week) => (
                <div className="bar-col" key={week.label}>
                  <span className="bar-value">{week.count}</span>
                  <div className="bar" style={{ height: `${(week.count / maxWeek) * 100}%` }} />
                  <span className="bar-label">wk of {week.label}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Throughput by author" hue="var(--stage-review)" count={authors.length}>
            <ul className="load">
              {authors.map(([author, s]) => (
                <li key={author}>
                  <Avatar login={author} />
                  <span className="load-name">{author}</span>
                  <span className="load-track">
                    <i style={{ width: `${(s.count / maxAuthor) * 100}%`, background: 'var(--hue)' }} />
                  </span>
                  <span className="load-count">{s.count}</span>
                  <span className="load-extra">
                    <span className="add">+{s.additions}</span> <span className="del">−{s.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div>
          <Panel
            title="Recently merged"
            hue="var(--stage-approved)"
            count={Math.min(15, merged.length)}
            note={merged.length > 15 ? `newest 15 of ${merged.length}` : 'newest first'}
          >
            <Queue empty="Nothing merged yet.">
              {merged.slice(0, 15).map((pr) => (
                <QueueRow
                  key={pr.id}
                  url={pr.url}
                  repo={pr.repo}
                  number={pr.number}
                  title={pr.title}
                  author={pr.author}
                  meta={formatHours(pr.cycleTimeHours)}
                />
              ))}
            </Queue>
          </Panel>
        </div>
      </div>
    </div>
  )
}
