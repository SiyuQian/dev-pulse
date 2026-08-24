import { describe, expect, it } from 'vitest'
import { clearPrivateClientData, runOAuthSecurityMigration } from './securityMigration'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const TOKENS_V2 = 'devpulse:tokens:v2'
const TOKEN_V1 = 'devpulse:token:v1'
const QUERY_CACHE = 'devpulse:query-cache:v1'
const MIGRATION = 'devpulse:oauth-security-migration:v1'

describe('OAuth client-data migration', () => {
  it('purges legacy PATs and private query data exactly once', () => {
    const storage = new MemoryStorage()
    storage.setItem(TOKENS_V2, '{"profile":"github-pat"}')
    storage.setItem(TOKEN_V1, 'legacy-github-pat')
    storage.setItem(QUERY_CACHE, '{"private":"pull requests"}')

    runOAuthSecurityMigration(storage)

    expect(storage.getItem(TOKENS_V2)).toBeNull()
    expect(storage.getItem(TOKEN_V1)).toBeNull()
    expect(storage.getItem(QUERY_CACHE)).toBeNull()
    expect(storage.getItem(MIGRATION)).toBe('complete')

    storage.setItem(QUERY_CACHE, '{"fresh":"oauth cache"}')
    runOAuthSecurityMigration(storage)
    expect(storage.getItem(QUERY_CACHE)).toBe('{"fresh":"oauth cache"}')
  })

  it('does not mark migration complete when browser cleanup fails', () => {
    class FailingStorage extends MemoryStorage {
      override removeItem(key: string): void {
        if (key === TOKEN_V1) throw new Error('storage blocked')
        super.removeItem(key)
      }
    }
    const storage = new FailingStorage()
    storage.setItem(TOKEN_V1, 'legacy-github-pat')

    runOAuthSecurityMigration(storage)

    expect(storage.getItem(MIGRATION)).toBeNull()
  })

  it('clears persisted private data whenever the user signs out', () => {
    const storage = new MemoryStorage()
    storage.setItem(TOKENS_V2, '{"profile":"github-pat"}')
    storage.setItem(TOKEN_V1, 'legacy-github-pat')
    storage.setItem(QUERY_CACHE, '{"private":"pull requests"}')

    clearPrivateClientData(storage)

    expect(storage.getItem(TOKENS_V2)).toBeNull()
    expect(storage.getItem(TOKEN_V1)).toBeNull()
    expect(storage.getItem(QUERY_CACHE)).toBeNull()
  })
})
