import type { PullRequest } from '../../api/types'

export type StageKey = 'changes' | 'review' | 'approved' | 'draft'

/**
 * Pipeline stages in triage order — most blocking first. The Console layout
 * reads top-to-bottom, so this order is also the priority order: something
 * with changes requested needs an author more urgently than a draft does.
 */
export const STAGES: { key: StageKey; label: string; hue: string }[] = [
  { key: 'changes', label: 'Changes requested', hue: 'var(--stage-changes)' },
  { key: 'review', label: 'Needs review', hue: 'var(--stage-review)' },
  { key: 'approved', label: 'Approved — ready to merge', hue: 'var(--stage-approved)' },
  { key: 'draft', label: 'Draft', hue: 'var(--stage-draft)' },
]

export function stageOf(pr: PullRequest): StageKey {
  if (pr.isDraft) return 'draft'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.reviewDecision === 'APPROVED') return 'approved'
  return 'review'
}

export function stageHue(key: StageKey): string {
  return STAGES.find((s) => s.key === key)?.hue ?? 'var(--stage-review)'
}

/**
 * Days since the last activity. The GraphQL payload carries no stage-transition
 * timeline, so `updatedAt` is the closest honest proxy for "stuck".
 */
export function idleDays(pr: PullRequest, now = Date.now()): number {
  return (now - new Date(pr.updatedAt).getTime()) / 86_400_000
}

export function ageDays(pr: PullRequest, now = Date.now()): number {
  return (now - new Date(pr.createdAt).getTime()) / 86_400_000
}

export function ciFailing(pr: PullRequest): boolean {
  return pr.ciStatus === 'FAILURE' || pr.ciStatus === 'ERROR'
}

export function ciRunning(pr: PullRequest): boolean {
  return pr.ciStatus === 'PENDING' || pr.ciStatus === 'EXPECTED'
}

export function repoShort(repo: string): string {
  return repo.split('/')[1] ?? repo
}

/**
 * Who a PR of your own is stuck behind. On the Mine view the author column is
 * dead weight — every row is you — so this replaces it, and it is also the axis
 * the "On me / On them" filter runs on.
 */
export interface BlockedOn {
  /** True when the next move is yours. */
  onMe: boolean
  /** Reviewers the ball is with. Empty whenever `onMe`. */
  reviewers: string[]
  note: string
}

/**
 * A PR in review with nobody asked counts as *yours*, not theirs: nobody else
 * knows it exists, so the only person who can unblock it is you.
 */
export function blockedOn(pr: PullRequest): BlockedOn {
  const mine = (note: string): BlockedOn => ({ onMe: true, reviewers: [], note })
  switch (stageOf(pr)) {
    case 'draft':
      return mine('still a draft')
    case 'changes':
      return mine('changes requested')
    case 'approved':
      return mine('approved — merge it')
    case 'review':
      return pr.requestedReviewers.length === 0
        ? mine('nobody asked yet')
        : { onMe: false, reviewers: pr.requestedReviewers, note: pr.requestedReviewers.join(', ') }
  }
}
