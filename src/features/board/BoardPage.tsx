import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { Avatar } from '../shared/ui'
import { formatDays, median } from '../shared/format'

type StageKey = 'draft' | 'review' | 'changes' | 'approved'
type Filter = 'all' | 'mine' | 'stale'

const STAGES: { key: StageKey; label: string; hue: string; tint: string; edge: string }[] = [
  { key: 'draft', label: 'Draft', hue: 'var(--stage-draft)', tint: '#f2f0f7', edge: '#e3dff0' },
  { key: 'review', label: 'Needs review', hue: 'var(--stage-review)', tint: '#edf2f7', edge: '#dce6f0' },
  { key: 'changes', label: 'Changes requested', hue: 'var(--stage-changes)', tint: '#f9f0ee', edge: '#f0dfdb' },
  { key: 'approved', label: 'Approved, ready to merge', hue: 'var(--stage-approved)', tint: '#edf5f0', edge: '#dceae2' },
]

function stageOf(pr: PullRequest): StageKey {
  if (pr.isDraft) return 'draft'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.reviewDecision === 'APPROVED') return 'approved'
  return 'review'
}

// Time since the last activity. The GraphQL payload has no stage-transition
// timeline, so this is the closest honest proxy for "stuck in this stage".
function idleDays(pr: PullRequest): number {
  return (Date.now() - new Date(pr.updatedAt).getTime()) / 86_400_000
}

function PrCard({ pr, staleDays, needsMyReview }: { pr: PullRequest; staleDays: number; needsMyReview: boolean }) {
  const idle = idleDays(pr)
  const stale = idle >= staleDays
  const repoName = pr.repo.split('/')[1] ?? pr.repo
  const ciBad = pr.ciStatus === 'FAILURE' || pr.ciStatus === 'ERROR'
  const ciPending = pr.ciStatus === 'PENDING' || pr.ciStatus === 'EXPECTED'

  return (
    <a
      className={`pr-card${stale ? ' is-stale' : ''}`}
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      style={{ '--idle': `${Math.min(100, (idle / staleDays) * 100)}%` } as CSSProperties}
    >
      <div className="pr-card-top">
        <span className="pr-card-repo">{repoName}</span>
        <span className="pr-card-num">#{pr.number}</span>
      </div>
      {needsMyReview && <span className="flag flag-mine">Waiting on you</span>}
      {stale && <span className="flag flag-stale">Idle {formatDays(idle)}</span>}
      {ciBad && <span className="flag flag-ci-bad">CI failing</span>}
      {ciPending && <span className="flag flag-ci-pending">CI running</span>}
      <p className="pr-card-title">{pr.title}</p>
      <div className="pr-card-foot">
        <Avatar login={pr.author} />
        <span className="pr-card-who">{pr.author}</span>
        <span className="pr-card-meta">
          <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span> · {formatDays(idle)}
        </span>
      </div>
      <div className="heat" />
    </a>
  )
}

export function BoardPage() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const { data, isPending, error, refetch, isFetching } = useOpenPrs(token, config)
  const [filter, setFilter] = useState<Filter>('all')

  const prs = data?.prs
  const staleDays = config.staleDays
  const visible = useMemo(() => {
    if (!prs) return []
    return prs.filter((pr) => {
      if (filter === 'mine') {
        return viewer !== undefined && (pr.author === viewer || pr.requestedReviewers.includes(viewer))
      }
      if (filter === 'stale') return idleDays(pr) >= staleDays
      return true
    })
  }, [prs, filter, viewer, staleDays])

  if (!token) {
    return <p className="empty">No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.</p>
  }
  if (config.repos.length === 0 && config.users.length === 0) {
    return <p className="empty">Watchlist is empty. Add repos or people in <Link to="/settings">Settings</Link>.</p>
  }
  if (error) return <p className="empty error">Failed to load PRs: {error.message}</p>
  if (isPending || !prs) return <p className="empty">Loading pull requests…</p>

  const needsMe = viewer ? prs.filter((pr) => pr.requestedReviewers.includes(viewer)).length : 0
  const staleCount = prs.filter((pr) => idleDays(pr) >= staleDays).length

  return (
    <div>
      <div className="flow-head">
        <div>
          <h2>Pipeline</h2>
          <p className="flow-summary">
            {prs.length} open
            {needsMe > 0 && <> · <span className="attn">{needsMe} waiting on you</span></>}
            {staleCount > 0 && <> · {staleCount} idle past {staleDays}d</>}
          </p>
        </div>
        <div className="flow-controls">
          <div className="filters">
            {([['all', 'All'], ['mine', 'Mine'], ['stale', 'Idle only']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          {data.rateLimit.limit > 0 && (
            <span className="rate-limit">quota {data.rateLimit.remaining}/{data.rateLimit.limit}</span>
          )}
          <button className="secondary" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {prs.length === 0 ? (
        <p className="empty">No open PRs in the watched repos and people. 🎉</p>
      ) : (
        <div className="flow-cols">
          {STAGES.map((stage) => {
            const inStage = visible
              .filter((pr) => stageOf(pr) === stage.key)
              .sort((a, b) => idleDays(b) - idleDays(a))
            const medianIdle = median(inStage.map(idleDays))
            return (
              <section
                key={stage.key}
                className="flow-col"
                style={{ '--hue': stage.hue, '--tint': stage.tint, '--edge': stage.edge } as CSSProperties}
              >
                <div className="flow-col-head">
                  <span className="dot" />
                  <h3>{stage.label}</h3>
                  <span className="count">{inStage.length}</span>
                </div>
                {medianIdle === null ? (
                  <p className="flow-col-empty">Nothing here.</p>
                ) : (
                  <p className="flow-col-idle">median idle {formatDays(medianIdle)}</p>
                )}
                {inStage.map((pr) => (
                  <PrCard
                    key={pr.id}
                    pr={pr}
                    staleDays={staleDays}
                    needsMyReview={viewer !== undefined && pr.requestedReviewers.includes(viewer)}
                  />
                ))}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
