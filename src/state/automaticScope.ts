import type { ViewerRepo } from '../api/github'
import type { WatchConfig } from '../storage/config'

export function automaticConfig(repositories: ViewerRepo[]): WatchConfig {
  const repos = [
    ...new Set(repositories.filter((repo) => !repo.isArchived).map((repo) => repo.nameWithOwner)),
  ]
  return { version: 1, repos, users: [], staleDays: 7 }
}
