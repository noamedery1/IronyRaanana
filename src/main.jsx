import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ErrorPage from './pages/ErrorPage.jsx'
import { setupClubPwa } from './clubPwa.js'
import { loadClubs } from './clubConfig.js'
import { initTheme } from './theme.js'
import './pwaInstall.js' // capture the browser's install prompt as early as possible

// Keep the installed PWA current. `registerType: 'autoUpdate'` only re-checks the service
// worker on a fresh navigation (or ~daily), so an app that's merely resumed from the
// background can keep serving a stale cached bundle. Poll for a new SW on an interval and
// whenever the app regains focus; autoUpdate's skipWaiting/clientsClaim then swaps it in,
// and controllerchange reloads the page once so everyone gets the deploy within ~a minute.
function keepAppFresh() {
  if (!('serviceWorker' in navigator)) return
  // Only reload when an EXISTING controller is replaced (a real deploy). On the very first
  // visit the page starts uncontrolled and the SW's initial claim also fires controllerchange
  // — reloading then would be a pointless flash, so guard on there already being a controller.
  if (navigator.serviceWorker.controller) {
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    })
  }
  navigator.serviceWorker.ready.then((reg) => {
    const check = () => { reg.update().catch(() => {}) }
    setInterval(check, 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
  }).catch(() => {})
}

// Load the dynamic club registry, then apply the active club's PWA identity, then render.
// ErrorBoundary catches any crash inside the app; the try/catch covers a failure during
// boot itself (e.g. the club registry not loading) — either way the user gets the
// designed ErrorPage, never a blank white screen.
async function boot() {
  try {
    initTheme()
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
  keepAppFresh()
}

boot()
