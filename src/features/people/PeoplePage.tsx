import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useOpenPrs, useMergedPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { Avatar } from '../shared/ui'
import { daysSince, formatCompact, formatHours, median } from '../shared/format'

type StageKey = 'draft' | 'review' | 'changes' | 'approved'

// The board's four stages, reused here as a per-person mix bar so a big open
// count reads as "what kind of open" at a glance, not just a number.
const STAGES: { key: StageKey; label: string; hue: string }[] = [
  { key: 'review', label: 'Needs review', hue: 'var(--stage-review)' },
  { key: 'changes', label: 'Changes requested', hue: 'var(--stage-changes)' },
  { key: 'approved', label: 'Approved', hue: 'var(--stage-approved)' },
  { key: 'draft', label: 'Draft', hue: 'var(--stage-draft)' },
]

function stageOf(pr: PullRequest): StageKey {
  if (pr.isDraft) return 'draft'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.reviewDecision === 'APPROVED') return 'approved'
  return 'review'
}

const WINDOWS = [7, 14, 28] as const
type Window = (typeof WINDOWS)[number]

interface Person {
  login: string
  open: PullRequest[]
  openByStage: Record<StageKey, number>
  merged: number
  additions: number
  deletions: number
  cycleTimes: number[]
  stale: number
}

export function PeoplePage() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const [days, setDays] = useState<Window>(28)
  // Stable per (mount, window) so the merged-PR query key doesn't churn.
  const [mountedAt] = useState(() => Date.now())
  const since = useMemo(
    () => new Date(mountedAt - days * 86_400_000).toISOString(),
    [mountedAt, days],
  )

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
          open: [],
          openByStage: { draft: 0, review: 0, changes: 0, approved: 0 },
          merged: 0,
          additions: 0,
          deletions: 0,
          cycleTimes: [],
          stale: 0,
        }
        byLogin.set(login, p)
      }
      return p
    }
    for (const pr of open.data?.prs ?? []) {
      const p = get(pr.author)
      p.open.push(pr)
      p.openByStage[stageOf(pr)] += 1
      if (daysSince(pr.updatedAt) >= staleDays) p.stale += 1
    }
    for (const pr of merged.data ?? []) {
      const p = get(pr.author)
      p.merged += 1
      p.additions += pr.additions
      p.deletions += pr.deletions
      p.cycleTimes.push(pr.cycleTimeHours)
    }
    return [...byLogin.values()].sort(
      (a, b) => b.open.length - a.open.length || b.merged - a.merged || a.login.localeCompare(b.login),
    )
  }, [open.data, merged.data, staleDays])

  if (!token) {
    return <p className="empty">No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.</p>
  }
  if (config.repos.length === 0 && config.users.length === 0) {
    return <p className="empty">Watchlist is empty. Add repos or people in <Link to="/settings">Settings</Link>.</p>
  }
  if (open.error) return <p className="empty error">Failed to load activity: {open.error.message}</p>
  if (open.isPending || !open.data) return <p className="empty">Loading team activity…</p>

  const totalOpen = open.data.prs.length
  const totalMerged = merged.data?.length ?? 0
  const maxOpen = Math.max(1, ...people.map((p) => p.open.length))
  const maxMerged = Math.max(1, ...people.map((p) => p.merged))
  const allCycles = people.flatMap((p) => p.cycleTimes)
  const medianCycle = median(allCycles)

  return (
    <div className="fade-in">
      <div className="flow-head">
        <div>
          <h2>People</h2>
          <p className="flow-summary">
            {people.length} active · {totalOpen} open now ·{' '}
            {merged.isPending ? 'counting merges…' : `${totalMerged} merged in ${days}d`}
          </p>
        </div>
        <div className="flow-controls">
          <div className="filters" role="group" aria-label="Merged window">
            {WINDOWS.map((w) => (
              <button key={w} aria-pressed={days === w} onClick={() => setDays(w)}>
                {w}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="tile"><strong>{totalOpen}</strong><span>open right now</span></div>
        <div className="tile"><strong>{merged.isPending ? '·' : totalMerged}</strong><span>merged in {days}d</span></div>
        <div className="tile"><strong>{people.filter((p) => p.open.length > 0).length}</strong><span>people with open work</span></div>
        <div className="tile"><strong>{medianCycle === null ? '·' : formatHours(medianCycle)}</strong><span>median cycle time</span></div>
      </div>

      {people.length === 0 ? (
        <p className="empty">No open or recently merged PRs for the watched repos and people. 🎉</p>
      ) : (
        <div className="people" role="table" aria-label="Per-person PR activity">
          <div className="people-head" role="row">
            <span role="columnheader">Person</span>
            <span role="columnheader">Open now</span>
            <span role="columnheader">Merged · {days}d</span>
            <span role="columnheader">Shipped</span>
            <span role="columnheader">Cycle</span>
          </div>
          {people.map((p) => {
            const cycle = median(p.cycleTimes)
            const isViewer = p.login === viewer
            return (
              <div className={`person${isViewer ? ' is-you' : ''}`} role="row" key={p.login}>
                <span className="person-who" role="cell">
                  <Avatar login={p.login} />
                  <span className="person-name">{p.login}{isViewer && <em> you</em>}</span>
                </span>

                <span className="person-open" role="cell">
                  <span className="person-open-n">{p.open.length}</span>
                  <span className="stage-bar" aria-hidden="true">
                    {STAGES.map((s) =>
                      p.openByStage[s.key] > 0 ? (
                        <i
                          key={s.key}
                          title={`${p.openByStage[s.key]} ${s.label}`}
                          style={{ flex: p.openByStage[s.key], background: s.hue } as CSSProperties}
                        />
                      ) : null,
                    )}
                    {p.open.length === 0 && <i className="stage-empty" style={{ flex: maxOpen }} />}
                  </span>
                  {p.stale > 0 && <span className="person-stale">{p.stale} idle</span>}
                </span>

                <span className="person-merged" role="cell">
                  <span className="person-merged-n">{merged.isPending ? '·' : p.merged}</span>
                  <span className="load-track" aria-hidden="true">
                    <i style={{ width: `${(p.merged / maxMerged) * 100}%`, background: 'var(--stage-approved)' }} />
                  </span>
                </span>

                <span className="person-lines" role="cell">
                  <span className="add">+{formatCompact(p.additions)}</span>{' '}
                  <span className="del">−{formatCompact(p.deletions)}</span>
                </span>

                <span className="person-cycle" role="cell">
                  {cycle === null ? '·' : formatHours(cycle)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
