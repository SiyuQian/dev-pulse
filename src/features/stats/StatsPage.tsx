import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMergedPrs } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import {
  Bars, Cell, Empty, Grid, LoadList, LoadRow, Queue, QueueRow, SectionHead, Seg, Stat,
} from '../shared/ui'
import { formatCompact, formatHours, median, percentile, signed } from '../shared/format'

const WINDOWS = [7, 28, 90] as const
type Window = (typeof WINDOWS)[number]

/** Weekly buckets over the window, oldest first. */
function bucketByWeek<T extends { mergedAt: string }>(items: T[], now: number, days: number) {
  const weeks = Math.max(1, Math.round(days / 7))
  return Array.from({ length: weeks }, (_, i) => {
    const weeksAgo = weeks - 1 - i
    const end = now - weeksAgo * 7 * 86_400_000
    const start = end - 7 * 86_400_000
    const inWeek = items.filter((pr) => {
      const t = new Date(pr.mergedAt).getTime()
      return t > start && t <= end
    })
    const d = new Date(start)
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, items: inWeek }
  })
}

export function StatsPage() {
  const { token, config } = useAppState()
  const [days, setDays] = useState<Window>(28)
  // Stable per (mount, window) so the query key doesn't churn.
  const [now] = useState(() => Date.now())
  const since = useMemo(() => new Date(now - days * 86_400_000).toISOString(), [now, days])
  const { data: merged, isPending, error } = useMergedPrs(token, config, since)

  if (!token) {
    return (
      <Empty>
        No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.
      </Empty>
    )
  }
  if (error) return <Empty error>Failed to load stats: {error.message}</Empty>
  if (isPending) return <Empty>Loading merge history…</Empty>

  const windowSeg = (
    <Seg label="Window" value={days} options={WINDOWS.map((w) => ({ value: w, label: `${w}d` }))} onChange={setDays} />
  )

  if (merged.length === 0) {
    return (
      <div className="fade-in">
        <SectionHead title="Trends" sub={`merged pull requests · ${days} days`}>{windowSeg}</SectionHead>
        <Empty>No PRs merged in the last {days} days for the watched repos and people.</Empty>
      </div>
    )
  }

  const weeks = bucketByWeek(merged, now, days)
  const lastWeek = weeks[weeks.length - 1]
  const prevWeek = weeks[weeks.length - 2]
  const countTrend = prevWeek ? lastWeek.items.length - prevWeek.items.length : null

  const cycles = merged.map((pr) => pr.cycleTimeHours)
  const medianCycle = median(cycles) ?? 0
  const p90 = percentile(cycles, 0.9) ?? 0
  const lastMedian = median(lastWeek.items.map((pr) => pr.cycleTimeHours))
  const prevMedian = prevWeek ? median(prevWeek.items.map((pr) => pr.cycleTimeHours)) : null
  const cycleTrend = lastMedian !== null && prevMedian !== null ? lastMedian - prevMedian : null

  const byAuthor = new Map<string, { count: number; additions: number; deletions: number; cycles: number[] }>()
  for (const pr of merged) {
    const entry = byAuthor.get(pr.author) ?? { count: 0, additions: 0, deletions: 0, cycles: [] }
    entry.count += 1
    entry.additions += pr.additions
    entry.deletions += pr.deletions
    entry.cycles.push(pr.cycleTimeHours)
    byAuthor.set(pr.author, entry)
  }
  const authors = [...byAuthor.entries()].sort((a, b) => b[1].count - a[1].count)
  const maxAuthor = Math.max(1, ...authors.map(([, s]) => s.count))

  const byRepo = new Map<string, number[]>()
  for (const pr of merged) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr.cycleTimeHours])
  const repos = [...byRepo.entries()]
    .map(([repo, values]) => ({
      repo,
      count: values.length,
      med: median(values) ?? 0,
      p90: percentile(values, 0.9) ?? 0,
    }))
    .sort((a, b) => b.med - a.med)
  const worstP90 = Math.max(1, ...repos.map((r) => r.p90))

  return (
    <div className="fade-in">
      <SectionHead title="Trends" sub={`${merged.length} merged · last ${days} days`}>{windowSeg}</SectionHead>

      <Grid cols={4}>
        <Cell title="Merged" note={`${(merged.length / (days / 7)).toFixed(1)} per week`}>
          <Stat
            value={merged.length}
            unit="PRs"
            delta={
              countTrend === null ? undefined : `last wk ${lastWeek.items.length} · ${signed(countTrend)} on prev`
            }
            tone={countTrend === null || countTrend === 0 ? 'flat' : countTrend > 0 ? 'up' : 'down'}
          />
        </Cell>
        <Cell title="Median cycle time" note="open → merge">
          <Stat
            value={formatHours(medianCycle)}
            delta={cycleTrend === null ? undefined : `${signed(Math.round(cycleTrend), 'h')} on prev week`}
            tone={cycleTrend === null || Math.round(cycleTrend) === 0 ? 'flat' : cycleTrend < 0 ? 'up' : 'down'}
          />
        </Cell>
        <Cell title="p90 cycle time" note="the long tail is what hurts">
          <Stat value={formatHours(p90)} />
        </Cell>
        <Cell title="Median diff" note="lines changed per merged PR">
          <Stat value={formatCompact(Math.round(median(merged.map((pr) => pr.additions + pr.deletions)) ?? 0))} unit="lines" />
        </Cell>
      </Grid>

      <Grid cols={2}>
        <Cell title="Merges per week" note={`${weeks.length} weeks, newest right`}>
          <Bars series={weeks.map((w) => ({ label: `wk ${w.label}`, value: w.items.length }))} />
        </Cell>
        <Cell title="Cycle time by repo" note="median, with p90 as the pale extent">
          {repos.length === 0 ? (
            <p className="cell-empty">No merged PRs.</p>
          ) : (
            <ul className="range-list">
              {repos.map((r) => (
                <li key={r.repo}>
                  <span className="range-head">
                    <span>{r.repo.split('/')[1] ?? r.repo}</span>
                    <em>
                      {formatHours(r.med)} · p90 {formatHours(r.p90)} · {r.count} merged
                    </em>
                  </span>
                  <span className="range-track">
                    <i className="p90" style={{ width: `${(r.p90 / worstP90) * 100}%` }} />
                    <i className="med" style={{ width: `${(r.med / worstP90) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cell>
      </Grid>

      <Grid cols={2}>
        <Cell title="Throughput by author" note={`${authors.length} authors · merged in ${days}d`}>
          <LoadList>
            {authors.map(([author, s]) => (
              <LoadRow
                key={author}
                login={author}
                value={s.count}
                ratio={s.count / maxAuthor}
                hue="var(--stage-approved)"
                sub={
                  <>
                    <span className="add">+{formatCompact(s.additions)}</span>{' '}
                    <span className="del">−{formatCompact(s.deletions)}</span> ·{' '}
                    {formatHours(median(s.cycles) ?? 0)} median
                  </>
                }
              />
            ))}
          </LoadList>
        </Cell>
        <Cell title="Recently merged" note={merged.length > 15 ? `newest 15 of ${merged.length}` : 'newest first'}>
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
        </Cell>
      </Grid>
    </div>
  )
}
