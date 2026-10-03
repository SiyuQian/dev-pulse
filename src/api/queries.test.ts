import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchViewerLogin, GitHubError } from './github'
import { retryUnlessFatal } from './queries'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retryUnlessFatal', () => {
  it('does not retry a dead session or the secondary rate limit', () => {
    expect(retryUnlessFatal(0, new GitHubError('Session expired', 401))).toBe(false)
    expect(retryUnlessFatal(0, new GitHubError('Forbidden', 403))).toBe(false)
  })

  it('does not retry the primary rate limit (HTTP 200 + RATE_LIMITED)', async () => {
    const payload = { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) }),
    )

    const error = await fetchViewerLogin('session:ada').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GitHubError)
    expect(retryUnlessFatal(0, error as Error)).toBe(false)
  })

  it('retries a transient upstream failure at most twice', () => {
    expect(retryUnlessFatal(0, new GitHubError('Bad gateway', 502))).toBe(true)
    expect(retryUnlessFatal(2, new GitHubError('Bad gateway', 502))).toBe(false)
  })
})
