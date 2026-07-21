const AVATAR_HUES = ['#7a6bc4', '#3d7ea6', '#b8703a', '#4e8b63', '#b0537c', '#8a6f2e', '#5b7fa8']

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
