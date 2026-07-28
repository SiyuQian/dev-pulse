const PROFILES_KEY = 'devpulse:profiles:v2'
const TOKENS_KEY = 'devpulse:tokens:v2'
// v1 stored a single token + a single watchlist. Read once, then migrated away.
const LEGACY_CONFIG_KEY = 'devpulse:config:v1'
const LEGACY_TOKEN_KEY = 'devpulse:token:v1'

export interface WatchConfig {
  version: 1
  repos: string[] // "owner/name"
  users: string[] // GitHub logins
  staleDays: number
}

/**
 * One GitHub account you can switch to. The token lives in a separate
 * localStorage key, keyed by `id` — so anything that serialises a profile
 * (share links, future exports) is token-free by construction.
 */
export interface Profile {
  id: string
  /** User-editable nickname. Falls back to the display name when no login is known yet. */
  label: string
  /** Login resolved from the token, cached so the switcher can label every account. */
  login?: string
  config: WatchConfig
}

export interface ProfileStore {
  version: 2
  activeId: string
  profiles: Profile[]
}

export const defaultConfig: WatchConfig = {
  version: 1,
  repos: [],
  users: [],
  staleDays: 7,
}

export function newProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `p${Math.random().toString(36).slice(2, 10)}`
}

export function createProfile(label: string, config: WatchConfig = defaultConfig): Profile {
  return { id: newProfileId(), label, config }
}

/** Next free "Account N" label, so added accounts never collide in the switcher. */
export function nextAccountLabel(profiles: Profile[]): string {
  const taken = new Set(profiles.map((p) => p.label))
  for (let n = profiles.length + 1; ; n++) {
    if (!taken.has(`Account ${n}`)) return `Account ${n}`
  }
}

/** What the switcher shows: the GitHub login once known, the nickname until then. */
export function profileName(profile: { label: string; login?: string }): string {
  return profile.login ? `@${profile.login}` : profile.label
}

function parseConfig(value: unknown): WatchConfig {
  const parsed = (value ?? {}) as Partial<WatchConfig>
  return {
    version: 1,
    repos: Array.isArray(parsed.repos) ? parsed.repos.filter(isRepoRef) : [],
    users: Array.isArray(parsed.users) ? parsed.users.filter(isLogin) : [],
    staleDays: typeof parsed.staleDays === 'number' && parsed.staleDays > 0 ? parsed.staleDays : 7,
  }
}

function parseProfile(value: unknown): Profile | null {
  const parsed = (value ?? {}) as Partial<Profile>
  if (typeof parsed.id !== 'string' || !parsed.id) return null
  return {
    id: parsed.id,
    label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label : 'Account',
    ...(isLogin(parsed.login) ? { login: parsed.login } : {}),
    config: parseConfig(parsed.config),
  }
}

function freshStore(): ProfileStore {
  const profile = createProfile('Account 1')
  return { version: 2, activeId: profile.id, profiles: [profile] }
}

/** Fold a v1 single-account setup into a one-profile v2 store. Returns null if there was none. */
function migrateLegacy(): ProfileStore | null {
  const rawConfig = localStorage.getItem(LEGACY_CONFIG_KEY)
  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
  if (!rawConfig && !legacyToken) return null

  let config = defaultConfig
  try {
    const parsed = rawConfig ? (JSON.parse(rawConfig) as Partial<WatchConfig>) : null
    if (parsed && parsed.version === 1) config = parseConfig(parsed)
  } catch {
    // Unreadable v1 config — carry the token over with an empty watchlist.
  }

  const profile = createProfile('Account 1', config)
  const store: ProfileStore = { version: 2, activeId: profile.id, profiles: [profile] }
  saveProfiles(store)
  saveTokens(legacyToken ? { [profile.id]: legacyToken } : {})
  localStorage.removeItem(LEGACY_CONFIG_KEY)
  localStorage.removeItem(LEGACY_TOKEN_KEY)
  return store
}

export function loadProfiles(): ProfileStore {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return migrateLegacy() ?? freshStore()
    const parsed = JSON.parse(raw) as Partial<ProfileStore>
    if (parsed.version !== 2) return freshStore()
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles.map(parseProfile).filter((p): p is Profile => p !== null)
      : []
    if (profiles.length === 0) return freshStore()
    const activeId = profiles.some((p) => p.id === parsed.activeId) ? parsed.activeId! : profiles[0].id
    return { version: 2, activeId, profiles }
  } catch {
    return freshStore()
  }
}

export function saveProfiles(store: ProfileStore): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(store))
}

/** Tokens by profile id. Kept apart from the profiles blob on purpose. */
export function loadTokens(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const tokens: Record<string, string> = {}
    for (const [id, token] of Object.entries(parsed)) {
      if (typeof token === 'string' && token) tokens[id] = token
    }
    return tokens
  } catch {
    return {}
  }
}

export function saveTokens(tokens: Record<string, string>): void {
  const kept = Object.entries(tokens).filter(([, token]) => Boolean(token))
  if (kept.length === 0) localStorage.removeItem(TOKENS_KEY)
  else localStorage.setItem(TOKENS_KEY, JSON.stringify(Object.fromEntries(kept)))
}

export function isRepoRef(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.-]+\/[\w.-]+$/.test(value)
}

export function isLogin(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(value)
}

// Share config (never the token) via URL fragment: #config=<base64url JSON>
export function encodeShareFragment(config: WatchConfig): string {
  const payload = { version: config.version, repos: config.repos, users: config.users, staleDays: config.staleDays }
  const json = JSON.stringify(payload)
  return '#config=' + btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeShareFragment(hash: string): WatchConfig | null {
  const match = /^#config=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) return null
  try {
    const b64 = match[1].replaceAll('-', '+').replaceAll('_', '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WatchConfig>
    if (parsed.version !== 1) return null
    return parseConfig(parsed)
  } catch {
    return null
  }
}
