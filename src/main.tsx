import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A share link arrives as "#config=<payload>", which HashRouter would otherwise
// swallow as a route. Stash the payload before the router mounts and land on Settings.
if (/^#config=[A-Za-z0-9_-]+$/.test(window.location.hash)) {
  sessionStorage.setItem('devpulse:pending-import', window.location.hash)
  window.location.hash = '#/settings'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
