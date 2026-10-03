import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSession } from './session'

afterEach(() => vi.unstubAllGlobals())

describe('fetchSession', () => {
  it('loads the allowlisted GitHub identity from the same-origin session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ authenticated: true, login: 'SiyuQian' }),
        }),
      ),
    )

    await expect(fetchSession()).resolves.toEqual({ login: 'SiyuQian' })
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  })

  it('returns null when the browser has no valid session', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 401 }))

    await expect(fetchSession()).resolves.toBeNull()
  })
})
