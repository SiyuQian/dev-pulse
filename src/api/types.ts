export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
export type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null

export interface PullRequest {
  id: string
  number: number
  title: string
  url: string
  repo: string // "owner/name"
  author: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  reviewDecision: ReviewDecision
  ciStatus: CiStatus
  requestedReviewers: string[]
  additions: number
  deletions: number
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: string
}
