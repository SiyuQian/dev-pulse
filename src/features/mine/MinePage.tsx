import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMyMergedPrs, useMyOpenPrs } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { AgeBar, AvatarRow, CiDot, Diff, Empty, SectionHead, Seg, Tag } from '../shared/ui'
import { formatDays, formatHours, median } from '../shared/format'
import {
  STAGES,
  ageDays,
  blockedOn,
  idleDays,
  repoShort,
  stageOf,
  type BlockedOn,
  type StageKey,
} from '../shared/prs'

type State = 'open' | 'merged'
type Blocked = 'all' | 'them' | 'me'

const STATES: { value: State; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged 30d' },
]

const BLOCKED: { value: Blocked; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'them', label: 'On them' },
  { value: 'me', label: 'On me' },
]

const MERGED_WINDOW_DAYS = 30

interface Row {
  pr: PullRequest
  stage: StageKey
  idle: number
  blocked: BlockedOn
  /** Outside the watchlist — visible here and nowhere else, so it gets marked. */
  offScope: boolean
}

function matches(query: string, ...fields: (string | number)[]): boolean {
  if (!query) return true
  return fields.join(' ').toLowerCase().includes(query)
}

/** The scope banner. This is the one view that deliberately ignores Settings. */
function ScopeBar({ query, offScope, total }: { query: string; offScope: number; total: number }) {
  return (
    <div className="scope-bar">
      <span>scope</span>
      <code className="q">{query}</code>
      <span>· ignores the watchlist</span>
      <span className="spacer" />
      {total > 0 && offScope > 0 && (
        <span>
          {offScope} of {total} outside your watched repos
        </span>
      )}
    </div>
  )
}

function WaitingOn({ blocked }: { blocked: BlockedOn }) {
  if (!blocked.onMe) {
    return (
      <span className="waiting">
        <AvatarRow logins={blocked.reviewers} />
        <span className="waiting-note">{blocked.note}</span>
      </span>
    )
  }
  return (
    <span className={`waiting self${blocked.note === 'nobody asked yet' ? ' nobody' : ''}`}>
      <span className="waiting-note">{blocked.note}</span>
    </span>
  )
}

function OpenTable({ rows, staleDays }: { rows: Row[]; staleDays: number }) {
  const groups = useMemo(
    () =>
      STAGES.map((stage) => ({
        ...stage,
        rows: rows.filter((r) => r.stage === stage.key).sort((a, b) => b.idle - a.idle),
      })).filter((g) => g.rows.length > 0),
    [rows],
  )

  return (
    <table className="prs">
      <thead>
        <tr>
          <th className="col-title">Pull request</th>
          <th className="col-person">Waiting on</th>
          <th>CI</th>
          <th>Diff</th>
          <th className="col-idle">Idle</th>
        </tr>
      </thead>
      {groups.map((group) => {
        const groupMedian = median(group.rows.map((r) => r.idle))
        return (
          <tbody key={group.key}>
            <tr className="group">
              <th colSpan={5} scope="colgroup">
                <span className="swatch" style={{ background: group.hue }} />
                {group.label}
                <span className="c">{group.rows.length}</span>
                {groupMedian !== null && (
                  <span className="c">median idle {formatDays(groupMedian)}</span>
                )}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr
                key={row.pr.id}
                // The lime edge means "on you" here. Every row is authored by
                // you, so marking them all would make the signal meaningless.
                className={row.blocked.onMe ? 'is-mine' : undefined}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return
                  window.open(row.pr.url, '_blank', 'noreferrer')
                }}
              >
                <td className="col-title">
                  <a href={row.pr.url} target="_blank" rel="noreferrer" className="title">
                    {row.pr.title}
                  </a>
                  <span className="slug">
                    {repoShort(row.pr.repo)} #{row.pr.number} · opened {formatDays(ageDays(row.pr))}{' '}
                    ago
                    {row.offScope && <Tag kind="offscope">not watched</Tag>}
                    {row.idle >= staleDays && <Tag kind="idle">idle</Tag>}
                  </span>
                </td>
                <td className="col-person">
                  <WaitingOn blocked={row.blocked} />
                </td>
                <td>
                  <CiDot status={row.pr.ciStatus} />
                </td>
                <td>
                  <Diff additions={row.pr.additions} deletions={row.pr.deletions} />
                </td>
                <td className="col-idle">
                  <AgeBar days={row.idle} staleDays={staleDays} />
                </td>
              </tr>
            ))}
          </tbody>
        )
      })}
    </table>
  )
}

/** Open PRs: search, filter, group by stage. */
function OpenView({ query, blocked }: { query: string; blocked: Blocked }) {
  const { token, config } = useAppState()
  const { data, isPending, error } = useMyOpenPrs(token)

  const watched = useMemo(() => new Set(config.repos), [config.repos])

  const allRows = useMemo<Row[]>(
    () =>
      (data?.prs ?? []).map((pr) => ({
        pr,
        stage: stageOf(pr),
        idle: idleDays(pr),
        blocked: blockedOn(pr),
        offScope: !watched.has(pr.repo),
      })),
    [data?.prs, watched],
  )

  const visible = useMemo(
    () =>
      allRows.filter((row) => {
        if (blocked === 'me' && !row.blocked.onMe) return false
        if (blocked === 'them' && row.blocked.onMe) return false
        return matches(query, row.pr.title, row.pr.repo, `#${row.pr.number}`, row.blocked.note)
      }),
    [allRows, blocked, query],
  )

  if (error && !data) return <Empty error>Failed to load your PRs: {error.message}</Empty>
  if (isPending || !data) return <Empty>Loading your pull requests…</Empty>

  const onMe = allRows.filter((r) => r.blocked.onMe).length
  const offScope = allRows.filter((r) => r.offScope).length
  const medianIdle = median(allRows.map((r) => r.idle))

  return (
    <>
      <ScopeBar query="is:pr is:open author:@me" offScope={offScope} total={allRows.length} />
      <SectionHead
        title="My pull requests"
        sub={[
          `${allRows.length} open`,
          `${onMe} on you`,
          medianIdle === null ? null : `median idle ${formatDays(medianIdle)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      {allRows.length === 0 ? (
        <Empty>You have no open pull requests anywhere. 🎉</Empty>
      ) : visible.length === 0 ? (
        <Empty>No PRs match this filter.</Empty>
      ) : (
        <OpenTable rows={visible} staleDays={config.staleDays} />
      )}
    </>
  )
}

/** Merged PRs: a flat list, newest first. No stage — they're all done. */
function MergedView({ query }: { query: string }) {
  const { token } = useAppState()
  const since = useMemo(
    () => new Date(Date.now() - MERGED_WINDOW_DAYS * 86_400_000).toISOString(),
    [],
  )
  const { data, isPending, error } = useMyMergedPrs(token, since)

  const visible = useMemo(
    () => (data ?? []).filter((pr) => matches(query, pr.title, pr.repo, `#${pr.number}`)),
    [data, query],
  )

  if (error && !data) return <Empty error>Failed to load your merged PRs: {error.message}</Empty>
  if (isPending || !data) return <Empty>Loading your merged pull requests…</Empty>

  const medianCycle = median(data.map((pr) => pr.cycleTimeHours))

  return (
    <>
      <ScopeBar
        query={`is:pr is:merged author:@me merged:>=${since.slice(0, 10)}`}
        offScope={0}
        total={data.length}
      />
      <SectionHead
        title="Merged in the last 30 days"
        sub={[
          `${data.length} merged`,
          medianCycle === null ? null : `median cycle ${formatHours(medianCycle)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      {data.length === 0 ? (
        <Empty>Nothing of yours merged in the last {MERGED_WINDOW_DAYS} days.</Empty>
      ) : visible.length === 0 ? (
        <Empty>No PRs match this filter.</Empty>
      ) : (
        <table className="prs">
          <thead>
            <tr>
              <th className="col-title">Pull request</th>
              <th>Merged</th>
              <th>Cycle time</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pr) => (
              <tr
                key={pr.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return
                  window.open(pr.url, '_blank', 'noreferrer')
                }}
              >
                <td className="col-title">
                  <a href={pr.url} target="_blank" rel="noreferrer" className="title">
                    {pr.title}
                  </a>
                  <span className="slug">
                    {repoShort(pr.repo)} #{pr.number}
                  </span>
                </td>
                <td>
                  <span className="mono-num">
                    {formatDays((Date.now() - new Date(pr.mergedAt).getTime()) / 86_400_000)} ago
                  </span>
                </td>
                <td>
                  <span className="mono-num">{formatHours(pr.cycleTimeHours)}</span>
                </td>
                <td>
                  <Diff additions={pr.additions} deletions={pr.deletions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/**
 * Everything you authored, across all of GitHub — the only view that is not
 * scoped to the watchlist, because "a PR I opened on a repo nobody watches" is
 * exactly the thing the board cannot show.
 */
export function MinePage() {
  const { token } = useAppState()
  const [state, setState] = useState<State>('open')
  const [blocked, setBlocked] = useState<Blocked>('all')
  const [query, setQuery] = useState('')

  if (!token) {
    return (
      <Empty>
        No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.
      </Empty>
    )
  }

  return (
    <div className="fade-in">
      <div className="mine-controls">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter pull requests"
        />
        <Seg label="State" value={state} options={STATES} onChange={setState} />
        {state === 'open' && (
          <Seg label="Blocked on" value={blocked} options={BLOCKED} onChange={setBlocked} />
        )}
      </div>

      {state === 'open' ? (
        <OpenView query={query.trim().toLowerCase()} blocked={blocked} />
      ) : (
        <MergedView query={query.trim().toLowerCase()} />
      )}
    </div>
  )
}
