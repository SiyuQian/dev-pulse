import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, Suspense, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider } from './state/AppState'
import { createQueryCachePersister, queryCachePersistOptions } from './storage/queryCache'
import { AttentionStrip } from './features/shared/AttentionStrip'
import { Empty } from './features/shared/ui'
import { Rail } from './features/shell/Rail'
import { TopBar } from './features/shell/TopBar'
import { BoardPage } from './features/board/BoardPage'
import { ReviewsPage } from './features/reviews/ReviewsPage'

// Board and Reviews are the landing view and its immediate neighbour, so they
// load eagerly; everything else is a deliberate navigation away from first
// paint and shouldn't sit in that bundle. Mine is frequently visited but never
// first, so it splits too — its query is the slow part, not its code.
const MinePage = lazy(() =>
  import('./features/mine/MinePage').then((m) => ({ default: m.MinePage })),
)
const PeoplePage = lazy(() =>
  import('./features/people/PeoplePage').then((m) => ({ default: m.PeoplePage })),
)
const StatsPage = lazy(() =>
  import('./features/stats/StatsPage').then((m) => ({ default: m.StatsPage })),
)
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

function Shell() {
  const path = useLocation().pathname
  // Settings is configuration, not triage — the attention strip would only be
  // noise there. Mine hides it for a different reason: the strip is derived from
  // the watchlist, and sitting it directly above a banner that says "this view
  // ignores the watchlist" is a contradiction the reader has to untangle.
  const bare = path === '/settings' || path === '/mine'
  return (
    <div className="shell">
      <Rail />
      <div className="work">
        <TopBar />
        {!bare && <AttentionStrip />}
        <main className="work-main">
          <Suspense fallback={<Empty>Loading…</Empty>}>
            <Routes>
              <Route path="/" element={<BoardPage />} />
              <Route path="/mine" element={<MinePage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/people" element={<PeoplePage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient())
  // Restoring the last response before first paint is what removes the blank
  // board on reload; PersistQueryClientProvider holds queries until it lands, so
  // there's no empty-then-hydrate flash.
  const [persistOptions] = useState(() => ({
    persister: createQueryCachePersister(),
    ...queryCachePersistOptions,
  }))
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AppStateProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AppStateProvider>
    </PersistQueryClientProvider>
  )
}
