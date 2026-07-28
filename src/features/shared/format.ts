// Bright hues that carry dark text — the Console shell is dark, so avatars are
// the light element, not the dark one.
const AVATAR_HUES = ['#8ab4f8', '#4ddb9a', '#c58af9', '#f28b82', '#fdd663', '#7fd8e8', '#f0a3c8']

export function avatarHue(login: string): string {
  let hash = 0
  for (const char of login) hash = (hash * 31 + char.charCodeAt(0)) % 9973
  return AVATAR_HUES[hash % AVATAR_HUES.length]
}

export function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

export function formatDays(days: number): string {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`
}

export function formatHours(hours: number): string {
  return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`
}

export function formatCompact(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

/** Signed delta with an explicit sign, for "against last week" notes. */
export function signed(n: number, unit = ''): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`
}
