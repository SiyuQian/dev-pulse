import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider } from './state/AppState'
import { AttentionStrip } from './features/shared/AttentionStrip'
import { Rail } from './features/shell/Rail'
import { TopBar } from './features/shell/TopBar'
import { PeoplePage } from './features/people/PeoplePage'
import { BoardPage } from './features/board/BoardPage'
import { ReviewsPage } from './features/reviews/ReviewsPage'
import { StatsPage } from './features/stats/StatsPage'
import { SettingsPage } from './features/settings/SettingsPage'

function Shell() {
  // Settings is configuration, not triage — the attention strip would only be noise there.
  const onSettings = useLocation().pathname === '/settings'
  return (
    <div className="shell">
      <Rail />
      <div className="work">
        <TopBar />
        {!onSettings && <AttentionStrip />}
        <main className="work-main">
          <Routes>
            <Route path="/" element={<BoardPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AppStateProvider>
    </QueryClientProvider>
  )
}
