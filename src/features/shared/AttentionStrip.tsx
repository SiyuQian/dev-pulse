import { useMemo } from 'react'
import { useOpenPrs, useViewer } from '../../api/queries'
import { useAppState } from '../../state/AppState'
import type { PullRequest } from '../../api/types'
import { Tag } from './ui'
import { formatCompact, formatDays } from './format'
import { ciFailing, idleDays, repoShort } from './prs'

type Reason = 'review' | 'ci' | 'idle' | 'changes'

interface Item {
  pr: PullRequest
  reason: Reason
  /** Lower sorts first. Kept explicit so the ordering is reviewable, not implied. */
  rank: number
  note: string
}

const TAG: Record<Reason, { kind: 'you' | 'idle' | 'ci' | 'ready'; label: string }> = {
  review: { kind: 'you', label: 'review' },
  ci: { kind: 'ci', label: 'ci failing' },
  changes: { kind: 'ci', label: 'changes' },
  idle: { kind: 'idle', label: 'idle' },
}

/**
 * The strip answers one question — "what needs me right now?" — and stays
 * pinned above every view so the answer never requires navigation.
 *
 * A PR appears at most once, under its most urgent reason.
 */
function buildItems(prs: PullRequest[], viewer: string | undefined, staleDays: number): Item[] {
  if (!viewer) return []
  const items: Item[] = []
  for (const pr of prs) {
    const idle = idleDays(pr)
    const mine = pr.author === viewer

    if (pr.requestedReviewers.includes(viewer) && !pr.isDraft) {
      items.push({
        pr,
        reason: 'review',
        rank: 0,
        note: `${pr.author} · requested ${formatDays(idle)} ago · +${formatCompact(pr.additions)} −${formatCompact(pr.deletions)}`,
      })
      continue
    }
    if (!mine) continue

    if (pr.reviewDecision === 'APPROVED' && ciFailing(pr)) {
      items.push({ pr, reason: 'ci', rank: 1, note: 'your PR · approved but CI is red' })
      continue
    }
    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      items.push({
        pr,
        reason: 'changes',
        rank: 2,
        note: `your PR · changes requested ${formatDays(idle)} ago`,
      })
      continue
    }
    if (idle >= staleDays && !pr.isDraft) {
      items.push({
        pr,
        reason: 'idle',
        rank: 3,
        note:
          pr.requestedReviewers.length === 0
            ? `your PR · idle ${formatDays(idle)} · no reviewer assigned`
            : `your PR · idle ${formatDays(idle)} · waiting on ${pr.requestedReviewers.join(', ')}`,
      })
    }
  }
  return items.sort((a, b) => a.rank - b.rank || idleDays(b.pr) - idleDays(a.pr))
}

export function AttentionStrip() {
  const { token, config } = useAppState()
  const { data: viewer } = useViewer(token)
  const { data } = useOpenPrs(token, config)

  const items = useMemo(
    () => buildItems(data?.prs ?? [], viewer, config.staleDays),
    [data?.prs, viewer, config.staleDays],
  )

  if (!token || !data) return null

  const waitingOnYou = items.filter((i) => i.reason === 'review').length

  return (
    <section className="attn" aria-label="Needs your attention">
      <div className="attn-lead">
        <span className="n">{waitingOnYou}</span>
        <span className="l">waiting on you</span>
      </div>
      {items.length === 0 ? (
        <p className="attn-clear">
          {viewer
            ? 'Nothing is blocked on you right now.'
            : 'Save a valid token to see what is waiting on you.'}
        </p>
      ) : (
        <div className="attn-items">
          {items.map((item) => (
            <a
              className="attn-item"
              key={`${item.reason}:${item.pr.id}`}
              href={item.pr.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="h">
                <Tag kind={TAG[item.reason].kind}>{TAG[item.reason].label}</Tag>
                <span className="mono-dim">
                  {repoShort(item.pr.repo)} #{item.pr.number}
                </span>
              </span>
              <span className="t">{item.pr.title}</span>
              <span className="m">{item.note}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
