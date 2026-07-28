import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { AgeBar, AvatarRow, Avatar, CiDot, Diff, Empty, SectionHead, Seg, Tag } from '../shared/ui'
import { formatDays, median } from '../shared/format'
import {
  STAGES,
  ageDays,
  ciFailing,
  idleDays,
  repoShort,
  stageOf,
  type StageKey,
} from '../shared/prs'

type Filter = 'all' | 'mine' | 'idle' | 'ci'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'idle', label: 'Idle' },
  { value: 'ci', label: 'CI red' },
]

interface Row {
  pr: PullRequest
  stage: StageKey
  idle: number
  needsMyReview: boolean
  isMine: boolean
}

/**
 * J/K to move, Enter to open, / to search — the row list is flat across stage
 * groups so navigation crosses group boundaries without a second keystroke.
 */
function useRowNav(rows: Row[], searchRef: React.RefObject<HTMLInputElement | null>) {
  const [cursor, setCursor] = useState(-1)

  // Keep the cursor in range as filters change the row set.
  useEffect(() => {
    setCursor((c) => (c >= rows.length ? rows.length - 1 : c))
  }, [rows.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur()
        return
      }
      if (rows.length === 0) return

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(rows.length - 1, c + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, c - 1))
      } else if (e.key === 'Enter' && cursor >= 0) {
        window.open(rows[cursor].pr.url, '_blank', 'noreferrer')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, searchRef])

  return [cursor, setCursor] as const
}

export function BoardPage() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const { data, isPending, error } = useOpenPrs(token, config)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const staleDays = config.staleDays

  const allRows = useMemo<Row[]>(() => {
    const prs = data?.prs ?? []
    return prs.map((pr) => ({
      pr,
      stage: stageOf(pr),
      idle: idleDays(pr),
      needsMyReview: viewer !== undefined && !pr.isDraft && pr.requestedReviewers.includes(viewer),
      isMine: pr.author === viewer,
    }))
  }, [data?.prs, viewer])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allRows.filter((row) => {
      if (
        q &&
        !`${row.pr.title} ${row.pr.repo} ${row.pr.author} #${row.pr.number}`
          .toLowerCase()
          .includes(q)
      ) {
        return false
      }
      if (filter === 'mine') return row.isMine || row.needsMyReview
      if (filter === 'idle') return row.idle >= staleDays
      if (filter === 'ci') return ciFailing(row.pr)
      return true
    })
  }, [allRows, filter, query, staleDays])

  // Grouped for display, flattened in the same order for keyboard navigation.
  const groups = useMemo(
    () =>
      STAGES.map((stage) => ({
        ...stage,
        rows: visible.filter((r) => r.stage === stage.key).sort((a, b) => b.idle - a.idle),
      })).filter((g) => g.rows.length > 0),
    [visible],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const [cursor, setCursor] = useRowNav(flat, searchRef)

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
  // With a persisted cache, `error` and `data` coexist: a failed background
  // refetch must not throw away rows we can still show. TopBar marks them stale.
  if (error && !data) return <Empty error>Failed to load PRs: {error.message}</Empty>
  if (isPending || !data) return <Empty>Loading pull requests…</Empty>

  const idleCount = allRows.filter((r) => r.idle >= staleDays).length
  const medianIdle = median(allRows.map((r) => r.idle))
  const sub = [
    `${allRows.length} open`,
    medianIdle === null ? null : `median idle ${formatDays(medianIdle)}`,
    idleCount > 0 ? `${idleCount} past ${staleDays}d` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="fade-in">
      <SectionHead title="Pipeline" sub={sub}>
        <input
          ref={searchRef}
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…  /"
          aria-label="Filter pull requests"
        />
        <Seg label="Filter" value={filter} options={FILTERS} onChange={setFilter} />
      </SectionHead>

      {allRows.length === 0 ? (
        <Empty>No open PRs in the watched repos and people. 🎉</Empty>
      ) : flat.length === 0 ? (
        <Empty>No PRs match this filter.</Empty>
      ) : (
        <table className="prs">
          <thead>
            <tr>
              <th className="col-title">Pull request</th>
              <th>Author</th>
              <th>Reviewers</th>
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
                  <th colSpan={6} scope="colgroup">
                    <span className="swatch" style={{ background: group.hue }} />
                    {group.label}
                    <span className="c">{group.rows.length}</span>
                    {groupMedian !== null && (
                      <span className="c">median idle {formatDays(groupMedian)}</span>
                    )}
                  </th>
                </tr>
                {group.rows.map((row) => {
                  const index = flat.indexOf(row)
                  return (
                    <tr
                      key={row.pr.id}
                      className={`${cursor === index ? 'is-cursor ' : ''}${row.needsMyReview ? 'is-mine' : ''}`}
                      onMouseEnter={() => setCursor(index)}
                      onClick={(e) => {
                        // Let the real anchor handle its own activation.
                        if ((e.target as HTMLElement).closest('a')) return
                        window.open(row.pr.url, '_blank', 'noreferrer')
                      }}
                    >
                      <td className="col-title">
                        <a href={row.pr.url} target="_blank" rel="noreferrer" className="title">
                          {row.pr.title}
                        </a>
                        <span className="slug">
                          {repoShort(row.pr.repo)} #{row.pr.number} · opened{' '}
                          {formatDays(ageDays(row.pr))} ago
                          {row.needsMyReview && <Tag kind="you">yours to review</Tag>}
                        </span>
                      </td>
                      <td>
                        <span className="who">
                          <Avatar login={row.pr.author} />
                          <span>{row.pr.author}</span>
                        </span>
                      </td>
                      <td>
                        <AvatarRow logins={row.pr.requestedReviewers} empty="none yet" />
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
                  )
                })}
              </tbody>
            )
          })}
        </table>
      )}

      <p className="hint-bar">
        <kbd>J</kbd> <kbd>K</kbd> move · <kbd>Enter</kbd> open on GitHub · <kbd>/</kbd> filter
      </p>
    </div>
  )
}
