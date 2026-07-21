import { Link } from 'react-router-dom'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { Avatar, Panel, Queue, QueueRow } from '../shared/ui'
import { daysSince, formatDays, median } from '../shared/format'

function oldestNote(prs: PullRequest[], verb = 'waiting'): string | undefined {
  if (prs.length === 0) return undefined
  const oldest = Math.max(...prs.map((pr) => daysSince(pr.updatedAt)))
  return `oldest ${verb} ${formatDays(oldest)}`
}

function rows(prs: PullRequest[], staleDays: number) {
  return [...prs]
    .sort((a, b) => daysSince(b.updatedAt) - daysSince(a.updatedAt))
    .map((pr) => {
      const idle = daysSince(pr.updatedAt)
      return (
        <QueueRow
          key={pr.id}
          url={pr.url}
          repo={pr.repo}
          number={pr.number}
          title={pr.title}
          author={pr.author}
          meta={formatDays(idle)}
          tone={idle >= staleDays ? 'bad' : idle >= staleDays * 0.6 ? 'warn' : undefined}
        />
      )
    })
}

export function ReviewsPage() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const { data, isPending, error } = useOpenPrs(token, config)

  if (!token) {
    return <p className="empty">No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.</p>
  }
  if (error) return <p className="empty error">Failed to load PRs: {error.message}</p>
  if (isPending) return <p className="empty">Loading review activity…</p>

  const staleDays = config.staleDays
  const prs = data.prs.filter((pr) => !pr.isDraft)
  const needsMe = viewer ? prs.filter((pr) => pr.requestedReviewers.includes(viewer)) : []
  const changesRequested = prs.filter((pr) => pr.reviewDecision === 'CHANGES_REQUESTED')
  const awaitingFirstReview = prs.filter(
    (pr) => pr.reviewDecision !== 'APPROVED' && pr.reviewDecision !== 'CHANGES_REQUESTED' && pr.requestedReviewers.length > 0,
  )
  const approved = prs.filter((pr) => pr.reviewDecision === 'APPROVED')

  const load = new Map<string, number>()
  for (const pr of prs) {
    for (const reviewer of pr.requestedReviewers) {
      load.set(reviewer, (load.get(reviewer) ?? 0) + 1)
    }
  }
  const reviewerLoad = [...load.entries()].sort((a, b) => b[1] - a[1])
  const maxLoad = Math.max(1, ...reviewerLoad.map(([, n]) => n))
  const awaitingMedian = median(awaitingFirstReview.map((pr) => daysSince(pr.updatedAt)))

  return (
    <div className="fade-in">
      <div className="page-head">
        <h2>Review activity</h2>
        <p>
          {prs.length} PRs in review across {config.repos.length + config.users.length} watched
          {config.users.length > 0 ? ' repos and people' : ' repos'}
        </p>
      </div>

      <div className="two-col">
        <div>
          <Panel
            title="Needs your review"
            hue="var(--attn)"
            count={needsMe.length}
            note={oldestNote(needsMe)}
          >
            <Queue empty={viewer ? 'Nothing waiting on you. 🎉' : 'Save a valid token to see PRs assigned to you.'}>
              {rows(needsMe, staleDays)}
            </Queue>
          </Panel>

          <Panel
            title="Changes requested"
            hue="var(--stage-changes)"
            count={changesRequested.length}
            note={oldestNote(changesRequested, 'on author')}
          >
            <Queue empty="No PRs blocked on author changes.">{rows(changesRequested, staleDays)}</Queue>
          </Panel>

          <Panel
            title="Awaiting first review"
            hue="var(--stage-review)"
            count={awaitingFirstReview.length}
            note={awaitingMedian === null ? undefined : `median wait ${formatDays(awaitingMedian)}`}
          >
            <Queue empty="No PRs waiting for a first review.">{rows(awaitingFirstReview, staleDays)}</Queue>
          </Panel>

          <Panel
            title="Approved, ready to merge"
            hue="var(--stage-approved)"
            count={approved.length}
            note={oldestNote(approved, 'unmerged')}
          >
            <Queue empty="No approved PRs waiting to merge.">{rows(approved, staleDays)}</Queue>
          </Panel>
        </div>

        <div>
          <Panel
            title="Review load"
            hue="var(--stage-review)"
            count={reviewerLoad.length}
            note={reviewerLoad.length === 0 ? undefined : `${prs.reduce((n, pr) => n + pr.requestedReviewers.length, 0)} open requests`}
          >
            {reviewerLoad.length === 0 ? (
              <p className="panel-empty">No outstanding review requests.</p>
            ) : (
              <ul className="load">
                {reviewerLoad.map(([reviewer, count]) => (
                  <li key={reviewer}>
                    <Avatar login={reviewer} />
                    <span className="load-name">{reviewer}</span>
                    <span className="load-track">
                      <i style={{ width: `${(count / maxLoad) * 100}%`, background: 'var(--hue)' }} />
                    </span>
                    <span className="load-count">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
