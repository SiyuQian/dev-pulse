import { describe, expect, it } from 'vitest'
import type { ViewerRepo } from '../api/github'
import { automaticConfig } from './automaticScope'

describe('automaticConfig', () => {
  it('watches every visible non-archived repository without manual setup', () => {
    const repos: ViewerRepo[] = [
      { nameWithOwner: 'acme/app', isPrivate: true, isArchived: false },
      { nameWithOwner: 'acme/legacy', isPrivate: true, isArchived: true },
      { nameWithOwner: 'SiyuQian/dev-pulse', isPrivate: false, isArchived: false },
      { nameWithOwner: 'acme/app', isPrivate: true, isArchived: false },
    ]

    expect(automaticConfig(repos)).toEqual({
      version: 1,
      repos: ['acme/app', 'SiyuQian/dev-pulse'],
      users: [],
      staleDays: 7,
    })
  })
})
