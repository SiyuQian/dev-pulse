import { Link } from 'react-router-dom'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'

function PrList({ prs, emptyText }: { prs: PullRequest[]; emptyText: string }) {
  if (prs.length === 0) return <p className="empty">{emptyText}</p>
  return (
    <ul className="pr-list">
      {prs.map((pr) => (
        <li key={pr.id}>
          <a href={pr.url} target="_blank" rel="noreferrer">
            <span className="col-repo">{pr.repo}</span> #{pr.number} {pr.title}
          </a>
          <span className="pr-list-meta">by {pr.author}</span>
        </li>
      ))}
    </ul>
  )
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

  return (
    <div className="reviews">
      <section>
        <h3>Needs your review ({needsMe.length})</h3>
        <PrList prs={needsMe} emptyText={viewer ? 'Nothing waiting on you. 🎉' : 'Save a valid token to see PRs assigned to you.'} />
      </section>
      <section>
        <h3>Changes requested ({changesRequested.length})</h3>
        <PrList prs={changesRequested} emptyText="No PRs blocked on author changes." />
      </section>
      <section>
        <h3>Awaiting first review ({awaitingFirstReview.length})</h3>
        <PrList prs={awaitingFirstReview} emptyText="No PRs waiting for a first review." />
      </section>
      <section>
        <h3>Approved, ready to merge ({approved.length})</h3>
        <PrList prs={approved} emptyText="No approved PRs waiting to merge." />
      </section>
      <section>
        <h3>Review load</h3>
        {reviewerLoad.length === 0 ? (
          <p className="empty">No outstanding review requests.</p>
        ) : (
          <table className="pr-table narrow">
            <thead><tr><th>Reviewer</th><th>Pending requests</th></tr></thead>
            <tbody>
              {reviewerLoad.map(([reviewer, count]) => (
                <tr key={reviewer}><td>{reviewer}</td><td>{count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
