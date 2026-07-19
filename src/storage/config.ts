const CONFIG_KEY = 'devpulse:config:v1'
const TOKEN_KEY = 'devpulse:token:v1'

export interface WatchConfig {
  version: 1
  repos: string[] // "owner/name"
  users: string[] // GitHub logins
  staleDays: number
}

export const defaultConfig: WatchConfig = {
  version: 1,
  repos: [],
  users: [],
  staleDays: 7,
}

export function loadConfig(): WatchConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return defaultConfig
    const parsed = JSON.parse(raw) as Partial<WatchConfig>
    if (parsed.version !== 1) return defaultConfig
    return {
      version: 1,
      repos: Array.isArray(parsed.repos) ? parsed.repos.filter(isRepoRef) : [],
      users: Array.isArray(parsed.users) ? parsed.users.filter(isLogin) : [],
      staleDays: typeof parsed.staleDays === 'number' && parsed.staleDays > 0 ? parsed.staleDays : 7,
    }
  } catch {
    return defaultConfig
  }
}

export function saveConfig(config: WatchConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function loadToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function saveToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
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
    return {
      version: 1,
      repos: Array.isArray(parsed.repos) ? parsed.repos.filter(isRepoRef) : [],
      users: Array.isArray(parsed.users) ? parsed.users.filter(isLogin) : [],
      staleDays: typeof parsed.staleDays === 'number' && parsed.staleDays > 0 ? parsed.staleDays : 7,
    }
  } catch {
    return null
  }
}
