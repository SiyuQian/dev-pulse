import { describe, expect, it } from 'vitest'
import { blockedOn } from './prs'
import type { PullRequest } from '../../api/types'

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr1',
    number: 1,
    title: 'Title',
    url: 'https://github.com/acme/app/pull/1',
    repo: 'acme/app',
    author: 'ada',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
    reviewDecision: 'REVIEW_REQUIRED',
    ciStatus: 'SUCCESS',
    requestedReviewers: [],
    additions: 10,
    deletions: 2,
    ...overrides,
  }
}

describe('blockedOn', () => {
  it('puts a PR awaiting review on the reviewers', () => {
    expect(blockedOn(pr({ requestedReviewers: ['bo', 'cy'] }))).toEqual({
      onMe: false,
      reviewers: ['bo', 'cy'],
      note: 'bo, cy',
    })
  })

  /**
   * The case the "On me" filter exists for: nobody else knows the PR is there,
   * so despite sitting in the review stage the only person who can move it is
   * the author.
   */
  it('puts a PR awaiting review with no reviewer back on you', () => {
    const result = blockedOn(pr({ requestedReviewers: [] }))
    expect(result.onMe).toBe(true)
    expect(result.note).toBe('nobody asked yet')
  })

  it('puts changes-requested on you', () => {
    const result = blockedOn(
      pr({ reviewDecision: 'CHANGES_REQUESTED', requestedReviewers: ['bo'] }),
    )
    expect(result).toEqual({ onMe: true, reviewers: [], note: 'changes requested' })
  })

  it('puts an approved PR on you — merging is your move', () => {
    const result = blockedOn(pr({ reviewDecision: 'APPROVED' }))
    expect(result).toEqual({ onMe: true, reviewers: [], note: 'approved — merge it' })
  })

  it('puts a draft on you even when reviewers are already requested', () => {
    const result = blockedOn(pr({ isDraft: true, requestedReviewers: ['bo'] }))
    expect(result).toEqual({ onMe: true, reviewers: [], note: 'still a draft' })
  })
})
