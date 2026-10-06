import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { I18nProvider } from './i18n.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ErrorPage from './pages/ErrorPage.jsx'
import { setupClubPwa } from './clubPwa.js'
import { loadClubs, isKnownClub, getClub } from './clubConfig.js'
import { initTheme } from './theme.js'
import { installNativeDeepLinks } from './native.js'
import './pwaInstall.js' // capture the browser's install prompt as early as possible

// On a per-club subdomain (<slug>.squadio.techbynoam.com) the club lives at the ORIGIN root, but
// the SPA routes are path-based ("/:club/…"). So once the club registry is loaded, carry the
// subdomain's club into the path (e.g. subdomain "/" -> "/fcraanana", "/join" -> "/fcraanana/join")
// so the existing routes + getActiveClub work unchanged. Different origin ⇒ its own installed app,
// service worker, push subscription and icon — which is what isolates multiple clubs on one device.
// Personal-link sign-in: /<club>?u=<token>&r=<role>&team=<team>. Restores identity from the URL so a
// saved link works in ANY context — fixes iOS in-app browsers / installed-PWA storage isolation, where
// localStorage doesn't carry between where you registered and where you reopen. The token is validated
// server-side on every authenticated call, so trusting it here (then stripping it from the URL) is safe.
function applyIdentityLink() {
    try {
        const p = new URLSearchParams(window.location.search);
        let u = p.get('u');
        let rRaw = p.get('r');
        let team = p.get('team') || '';
        let fromPath = false;
        if (!u) {
            // iOS gives an installed standalone PWA its OWN storage AND strips the query from the
            // manifest start_url — so a ?u= personal link can't carry identity into the home-screen
            // app. The PATH survives, so also accept /<club>/u/<token>[/<role>[/<team>]] and sign in
            // from it. (This is what the schedule page points the installed icon's start_url at.)
            const seg = window.location.pathname.split('/').filter(Boolean); // [club, 'u', token, role?, teamEnc?]
            const i = seg.indexOf('u');
            if (i >= 1 && seg[i + 1]) {
                try { u = decodeURIComponent(seg[i + 1]); } catch { u = seg[i + 1]; }
                rRaw = seg[i + 2] || '';
                try { team = seg[i + 3] ? decodeURIComponent(seg[i + 3]) : ''; } catch { team = seg[i + 3] || ''; }
                fromPath = true;
            }
        }
        if (!u) return;
        const r = rRaw === 'operator' ? 'operator' : (rRaw === 'member' ? 'member' : (team ? 'member' : ''));
        // An operator link must NOT silently bury an existing parent (member) identity with no way
        // back (the bug: parent board vanishes). Before taking over the active pointers, preserve the
        // parent identity — snapshot a legacy single-team member into `memberships` (modern members
        // already keep the array) — and stash the operator token under its own key so the
        // AccountSwitcher can flip between the two identities.
        if (r === 'operator') {
            try {
                const prevRole = localStorage.getItem('userRole');
                const prevTok = localStorage.getItem('userToken');
                const prevTeam = localStorage.getItem('userTeam');
                let list = JSON.parse(localStorage.getItem('memberships') || '[]');
                if (!Array.isArray(list)) list = [];
                if (prevRole === 'member' && prevTeam && prevTok && !list.find((m) => m && m.team === prevTeam)) {
                    list.push({ team: prevTeam, token: prevTok });
                    localStorage.setItem('memberships', JSON.stringify(list));
                }
            } catch { /* ignore */ }
            localStorage.setItem('operatorToken', u);
        }
        localStorage.setItem('userToken', u);
        if (r) localStorage.setItem('userRole', r);
        if (r) localStorage.setItem('entryRole', r);
        if (team) {
            localStorage.setItem('userTeam', team);
            localStorage.setItem('entryTeam', team);
            let list = [];
            try { list = JSON.parse(localStorage.getItem('memberships') || '[]'); } catch { list = []; }
            if (!Array.isArray(list)) list = [];
            if (!list.find((m) => m && m.team === team)) list.push({ team, token: u });
            localStorage.setItem('memberships', JSON.stringify(list));
        }
        if (fromPath) {
            // Strip the /u/<token>/… segments, land cleanly on /<club>.
            const club = window.location.pathname.split('/').filter(Boolean)[0] || '';
            window.history.replaceState(null, '', '/' + club + window.location.hash);
        } else {
            p.delete('u'); p.delete('r'); p.delete('team');
            const qs = p.toString();
            window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
        }
    } catch { /* non-fatal */ }
}

// A club with its own subdomain must be used ONLY on that origin — otherwise a person who registers
// on the subdomain (invite links point there) but reopens an older apex PWA lands on an origin with
// none of their identity (localStorage is per-origin) and sees the anonymous welcome. The server
// 302s apex→subdomain, but a cached PWA shell can bypass it, so converge on the client too: on the
// bare apex, for a subdomain-club path, send an ANONYMOUS visitor to the subdomain. We deliberately
// do NOT move someone who already has identity on the apex (they registered here) — only the
// identity-less, so no one is cut off from an account that lives on this origin.
function redirectApexToSubdomain() {
    try {
        const parts = window.location.hostname.split('.');
        if (parts.length <= 2) return;            // localhost / bare domain — nothing to do
        if (isKnownClub(parts[0])) return;        // already on a club subdomain
        const seg = window.location.pathname.split('/').filter(Boolean)[0];
        if (!seg) return;                         // apex root = product/sales page
        const club = getClub(seg);
        if (!club || !club.subdomain || !club.inviteOrigin) return;
        const hasLocalIdentity = localStorage.getItem('userToken') || localStorage.getItem('isAdmin')
            || localStorage.getItem('trainerToken') || localStorage.getItem('mgrToken:' + seg);
        if (hasLocalIdentity) return;             // registered on THIS origin — don't strand them
        window.location.replace(club.inviteOrigin + window.location.pathname + window.location.search + window.location.hash);
        return true; // navigation started; caller should stop booting
    } catch { return false; }
}

function applySubdomainClub() {
    try {
        const host = window.location.hostname;
        const parts = host.split('.');
        if (parts.length <= 2) return; // root domain or localhost — nothing to do
        const first = parts[0];
        if (!isKnownClub(first)) return;
        const segs = window.location.pathname.split('/').filter(Boolean);
        if (segs[0] === first) return; // already carries the club
        const rest = window.location.pathname === '/' ? '' : window.location.pathname;
        window.history.replaceState(null, '', `/${first}${rest}${window.location.search}${window.location.hash}`);
    } catch { /* non-fatal */ }
}

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
    applyIdentityLink() // a personal ?u=<token> link signs the user in before any routing decision
    if (redirectApexToSubdomain()) return // converging to the club's own origin — stop; the page is navigating
    applySubdomainClub() // carry a subdomain's club into the path before routing/PWA identity
    setupClubPwa()
    installNativeDeepLinks() // native app: a tapped invite link (warm) navigates the WebView to it
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
