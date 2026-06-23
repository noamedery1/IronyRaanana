import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ErrorPage from './pages/ErrorPage.jsx'
import { setupClubPwa } from './clubPwa.js'
import { loadClubs } from './clubConfig.js'

// Load the dynamic club registry, then apply the active club's PWA identity, then render.
// ErrorBoundary catches any crash inside the app; the try/catch covers a failure during
// boot itself (e.g. the club registry not loading) — either way the user gets the
// designed ErrorPage, never a blank white screen.
async function boot() {
  try {
    await loadClubs()
    setupClubPwa()
  } catch (err) {
    console.error('Boot failed:', err)
    createRoot(document.getElementById('root')).render(<ErrorPage mode="error" />)
    return
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

boot()
