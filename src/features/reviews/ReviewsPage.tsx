import { Link } from 'react-router-dom'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import {
  Cell,
  Empty,
  Grid,
  LoadList,
  LoadRow,
  Queue,
  QueueRow,
  SectionHead,
  Stat,
} from '../shared/ui'
import { daysSince, formatDays, median } from '../shared/format'
import { idleDays } from '../shared/prs'

function oldest(prs: PullRequest[]): number | null {
  if (prs.length === 0) return null
  return Math.max(...prs.map((pr) => daysSince(pr.updatedAt)))
}

function rows(prs: PullRequest[], staleDays: number) {
  return [...prs]
    .sort((a, b) => idleDays(b) - idleDays(a))
    .map((pr) => {
      const idle = idleDays(pr)
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
    return (
      <Empty>
        No GitHub token configured. Add one in <Link to="/settings">Settings</Link>.
      </Empty>
    )
  }
  if (error && !data) return <Empty error>Failed to load PRs: {error.message}</Empty>
  if (isPending || !data) return <Empty>Loading review activity…</Empty>

  const staleDays = config.staleDays
  const prs = data.prs.filter((pr) => !pr.isDraft)
  const needsMe = viewer ? prs.filter((pr) => pr.requestedReviewers.includes(viewer)) : []
  const changesRequested = prs.filter((pr) => pr.reviewDecision === 'CHANGES_REQUESTED')
  const awaitingFirst = prs.filter(
    (pr) =>
      pr.reviewDecision !== 'APPROVED' &&
      pr.reviewDecision !== 'CHANGES_REQUESTED' &&
      pr.requestedReviewers.length > 0,
  )
  const unassigned = prs.filter(
    (pr) => pr.requestedReviewers.length === 0 && pr.reviewDecision !== 'APPROVED',
  )
  const approved = prs.filter((pr) => pr.reviewDecision === 'APPROVED')

  // Outstanding review requests per person — the load that exists right now,
  // not reviews historically given (the search payload carries no review events).
  const load = new Map<string, number>()
  for (const pr of prs) {
    for (const reviewer of pr.requestedReviewers) load.set(reviewer, (load.get(reviewer) ?? 0) + 1)
  }
  const reviewerLoad = [...load.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const maxLoad = Math.max(1, ...reviewerLoad.map(([, n]) => n))
  const totalRequests = prs.reduce((n, pr) => n + pr.requestedReviewers.length, 0)

  const myOldest = oldest(needsMe)
  const awaitingMedian = median(awaitingFirst.map((pr) => idleDays(pr)))
  const approvedOldest = oldest(approved)

  return (
    <div className="fade-in">
      <SectionHead
        title="Review load"
        sub={`${prs.length} PRs in review · ${totalRequests} outstanding requests`}
      />

      <Grid cols={4}>
        <Cell
          title="Your queue"
          note={myOldest === null ? 'nothing assigned' : `oldest ${formatDays(myOldest)}`}
        >
          <Stat value={needsMe.length} unit="to review" mine={needsMe.length > 0} />
        </Cell>
        <Cell
          title="Awaiting first review"
          note={
            awaitingMedian === null ? 'none waiting' : `median wait ${formatDays(awaitingMedian)}`
          }
        >
          <Stat value={awaitingFirst.length} unit="PRs" />
        </Cell>
        <Cell title="No reviewer assigned" note="nobody has been asked yet">
          <Stat
            value={unassigned.length}
            unit="PRs"
            tone={unassigned.length > 0 ? 'down' : 'flat'}
          />
        </Cell>
        <Cell
          title="Approved, unmerged"
          note={approvedOldest === null ? 'none waiting' : `oldest ${formatDays(approvedOldest)}`}
        >
          <Stat value={approved.length} unit="ready" />
        </Cell>
      </Grid>

      <Grid cols={2}>
        <Cell
          title="Needs your review"
          note={viewer ? `assigned to @${viewer}` : 'save a valid token to see yours'}
        >
          <Queue
            empty={
              viewer
                ? 'Nothing waiting on you. 🎉'
                : 'Save a valid token to see PRs assigned to you.'
            }
          >
            {rows(needsMe, staleDays)}
          </Queue>
        </Cell>
        <Cell
          title="Outstanding requests per person"
          note={`${reviewerLoad.length} people carrying ${totalRequests} requests`}
        >
          {reviewerLoad.length === 0 ? (
            <p className="cell-empty">No outstanding review requests.</p>
          ) : (
            <LoadList>
              {reviewerLoad.map(([reviewer, count]) => (
                <LoadRow
                  key={reviewer}
                  login={reviewer}
                  value={count}
                  ratio={count / maxLoad}
                  hue="var(--stage-review)"
                  isViewer={reviewer === viewer}
                />
              ))}
            </LoadList>
          )}
        </Cell>
      </Grid>

      <Grid cols={3}>
        <Cell title="Blocked on author" note="changes requested, oldest first">
          <Queue empty="No PRs blocked on author changes.">
            {rows(changesRequested, staleDays)}
          </Queue>
        </Cell>
        <Cell title="Nobody asked yet" note="open PRs with no reviewer, oldest first">
          <Queue empty="Every open PR has a reviewer.">{rows(unassigned, staleDays)}</Queue>
        </Cell>
        <Cell title="Approved, ready to merge" note="oldest first — these are free wins">
          <Queue empty="No approved PRs waiting to merge.">{rows(approved, staleDays)}</Queue>
        </Cell>
      </Grid>
    </div>
  )
}
