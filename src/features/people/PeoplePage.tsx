import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useMergedPrs, useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import { Avatar, Cell, Empty, Grid, SectionHead, Seg, Stat } from '../shared/ui'
import { formatCompact, formatHours, median } from '../shared/format'
import { STAGES, idleDays, stageOf, type StageKey } from '../shared/prs'

const WINDOWS = [7, 14, 28] as const
type Window = (typeof WINDOWS)[number]

interface Person {
  login: string
  open: number
  openByStage: Record<StageKey, number>
  idle: number
  reviewRequests: number
  merged: number
  additions: number
  deletions: number
  cycleTimes: number[]
}

export function PeoplePage() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const [days, setDays] = useState<Window>(28)
  // Stable per (mount, window) so the merged-PR query key doesn't churn.
  const [mountedAt] = useState(() => Date.now())
  const since = useMemo(() => new Date(mountedAt - days * 86_400_000).toISOString(), [mountedAt, days])

  const open = useOpenPrs(token, config)
  const merged = useMergedPrs(token, config, since)
  const staleDays = config.staleDays

  const people = useMemo<Person[]>(() => {
    const byLogin = new Map<string, Person>()
    const get = (login: string): Person => {
      let p = byLogin.get(login)
      if (!p) {
        p = {
          login,
          open: 0,
          openByStage: { draft: 0, review: 0, changes: 0, approved: 0 },
          idle: 0,
          reviewRequests: 0,
          merged: 0,
          additions: 0,
          deletions: 0,
          cycleTimes: [],
        }
        byLogin.set(login, p)
      }
      return p
    }
    for (const pr of open.data?.prs ?? []) {
      const author = get(pr.author)
      author.open += 1
      author.openByStage[stageOf(pr)] += 1
      if (idleDays(pr) >= staleDays) author.idle += 1
      // Reviewers count as active people even with no open PRs of their own.
      for (const reviewer of pr.requestedReviewers) get(reviewer).reviewRequests += 1
    }
    for (const pr of merged.data ?? []) {
      const p = get(pr.author)
      p.merged += 1
      p.additions += pr.additions
      p.deletions += pr.deletions
      p.cycleTimes.push(pr.cycleTimeHours)
    }
    return [...byLogin.values()].sort(
      (a, b) => b.open - a.open || b.merged - a.merged || a.login.localeCompare(b.login),
    )
  }, [open.data, merged.data, staleDays])

  if (!token) {
    return (
      <Empty>
        No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.
      </Empty>
    )
  }
  if (config.repos.length === 0 && config.users.length === 0) {
    return (
      <Empty>
        Watchlist is empty. Add repos or people in <Link to="/settings">Settings</Link>.
      </Empty>
    )
  }
  if (open.error && !open.data) return <Empty error>Failed to load activity: {open.error.message}</Empty>
  if (open.isPending || !open.data) return <Empty>Loading team activity…</Empty>

  const totalOpen = open.data.prs.length
  const totalMerged = merged.data?.length ?? 0
  const maxOpen = Math.max(1, ...people.map((p) => p.open))
  const maxMerged = Math.max(1, ...people.map((p) => p.merged))
  const medianCycle = median(people.flatMap((p) => p.cycleTimes))
  const carrying = people.filter((p) => p.open > 0).length

  return (
    <div className="fade-in">
      <SectionHead title="People" sub={`${people.length} active · ${totalOpen} open now`}>
        <Seg
          label="Merged window"
          value={days}
          options={WINDOWS.map((w) => ({ value: w, label: `${w}d` }))}
          onChange={setDays}
        />
      </SectionHead>

      <Grid cols={4}>
        <Cell title="Open right now" note="across the watchlist">
          <Stat value={totalOpen} unit="PRs" />
        </Cell>
        <Cell title={`Merged · ${days}d`} note={merged.isPending ? 'counting…' : `${(totalMerged / (days / 7)).toFixed(1)} per week`}>
          <Stat value={merged.isPending ? '·' : totalMerged} unit="PRs" />
        </Cell>
        <Cell title="People with open work" note={`of ${people.length} active`}>
          <Stat value={carrying} unit="people" />
        </Cell>
        <Cell title="Median cycle time" note="open → merge">
          <Stat value={medianCycle === null ? '·' : formatHours(medianCycle)} />
        </Cell>
      </Grid>

      {people.length === 0 ? (
        <Empty>No open or recently merged PRs for the watched repos and people. 🎉</Empty>
      ) : (
        <table className="prs people-table">
          <thead>
            <tr>
              <th className="col-person">Person</th>
              <th className="col-mix">Open now</th>
              <th>Idle</th>
              <th>Review requests</th>
              <th className="col-mix">Merged · {days}d</th>
              <th>Shipped</th>
              <th>Median cycle</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const cycle = median(p.cycleTimes)
              const isViewer = p.login === viewer
              return (
                <tr key={p.login} className={isViewer ? 'is-mine' : undefined}>
                  <td className="col-person">
                    <span className="who">
                      <Avatar login={p.login} />
                      <span>
                        {p.login}
                        {isViewer && <em className="you-tag">you</em>}
                      </span>
                    </span>
                  </td>

                  <td className="col-mix">
                    <span className="mix">
                      <b>{p.open}</b>
                      <span className="mix-bar" aria-hidden="true">
                        {p.open === 0 ? (
                          <i className="mix-empty" style={{ flex: maxOpen }} />
                        ) : (
                          <>
                            {STAGES.map((s) =>
                              p.openByStage[s.key] > 0 ? (
                                <i
                                  key={s.key}
                                  title={`${p.openByStage[s.key]} ${s.label}`}
                                  style={{ flex: p.openByStage[s.key], background: s.hue } as CSSProperties}
                                />
                              ) : null,
                            )}
                            {p.open < maxOpen && <i className="mix-empty" style={{ flex: maxOpen - p.open }} />}
                          </>
                        )}
                      </span>
                    </span>
                  </td>

                  <td>{p.idle > 0 ? <span className="warn-num">{p.idle}</span> : <span className="mono-dim">—</span>}</td>

                  <td>{p.reviewRequests > 0 ? <span className="mono-num">{p.reviewRequests}</span> : <span className="mono-dim">—</span>}</td>

                  <td className="col-mix">
                    <span className="mix">
                      <b>{merged.isPending ? '·' : p.merged}</b>
                      <span className="mix-bar" aria-hidden="true">
                        <i style={{ flex: Math.max(0.001, p.merged), background: 'var(--stage-approved)' }} />
                        {p.merged < maxMerged && <i className="mix-empty" style={{ flex: maxMerged - p.merged }} />}
                      </span>
                    </span>
                  </td>

                  <td>
                    <span className="diff">
                      <span className="add">+{formatCompact(p.additions)}</span>{' '}
                      <span className="del">−{formatCompact(p.deletions)}</span>
                    </span>
                  </td>

                  <td>
                    {cycle === null ? <span className="mono-dim">—</span> : <span className="mono-num">{formatHours(cycle)}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
