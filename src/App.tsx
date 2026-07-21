import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './state/AppState'
import { PeoplePage } from './features/people/PeoplePage'
import { BoardPage } from './features/board/BoardPage'
import { ReviewsPage } from './features/reviews/ReviewsPage'
import { StatsPage } from './features/stats/StatsPage'
import { SettingsPage } from './features/settings/SettingsPage'

export default function App() {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <HashRouter>
          <header className="app-header">
            <span className="brand">
              <span className="brand-mark" aria-hidden="true" />
              <h1>dev&#8202;pulse</h1>
            </span>
            <nav>
              <NavLink to="/" end>People</NavLink>
              <NavLink to="/board">Board</NavLink>
              <NavLink to="/reviews">Reviews</NavLink>
              <NavLink to="/stats">Stats</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
          </header>
          <main className="app-main">
            <Routes>
              <Route path="/" element={<PeoplePage />} />
              <Route path="/board" element={<BoardPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </HashRouter>
      </AppStateProvider>
    </QueryClientProvider>
  )
}
