import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'
import { setupClubPwa } from './clubPwa.js'
import { loadClubs } from './clubConfig.js'

// Load the dynamic club registry, then apply the active club's PWA identity, then render.
async function boot() {
  await loadClubs()
  setupClubPwa()
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  )
}

boot()
