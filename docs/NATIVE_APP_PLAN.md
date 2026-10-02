# Squadio — Native App Plan (iOS + Android)

Goal: turn the existing React/Vite PWA into a **real app** on the App Store and Google Play,
to escape the iOS PWA limitations we hit (localStorage eviction/isolation, unreliable web push,
in-app-browser/manifest/start_url quirks) and to get native push, persistent storage, and
invite links that open the app directly.

## Decisions locked in
- **One app for the whole system** ("Squadio"), not an app per club.
- **Multi-club inside one app:** the invite link carries the **club code + role (+ team)**, so the
  app opens straight into the right registration (manager / trainer / operator / parent).
- **Multi-team stays as-is** (a parent can belong to several teams).
- **Club switching:** a user who belongs to more than one club (e.g. the superuser) can switch
  clubs inside the app.
- **Launcher icon:** one fixed "Squadio" icon (a single store app cannot swap its launcher icon to
  an arbitrary uploaded club logo). Per-club branding lives **inside** the app — splash, header,
  colors, logo — switched by the active club. (True per-club icons would need separate white-label
  apps, which we are not doing.)

## Approach: Capacitor (reuse the web app)
Wrap the existing React app in a native shell with **Capacitor**. ~95% of current code is reused.
Native plugins provide push (APNs/FCM), persistent storage, and deep links. Web content can be
updated OTA (no store review for content-only changes); only native-shell changes need review.

Rejected: React Native (full UI rewrite — too costly), Android-only TWA (doesn't fix iOS).

---

## Architecture changes the native app needs

### 1. API base URL (foundational)
Today every call is relative (`fetch('/api/...')`) and relies on same-origin. In a bundled native
app the webview origin is `capacitor://localhost` / `https://localhost`, so relative `/api` breaks.
- Introduce a single `API_BASE` (e.g. `https://squadio.techbynoam.com`) and route all API calls
  through one helper (`apiFetch`) so there is one place to set the host.
- Keep same-origin behavior for the web build (API_BASE = '').

### 2. Identity & multi-club store (native)
- Move identity off `localStorage` to `@capacitor/preferences` (persists, never evicted, shared
  across app launches). Keep a web fallback.
- Store a **list of club memberships**: `[{ club, role, team[], token, name }]`, plus the active club.
- Club switcher UI for users with more than one membership.

### 3. Entry & invite (deep links)
- Universal Links (iOS) + App Links (Android): the domain hosts `apple-app-site-association` and
  `.well-known/assetlinks.json` (we control the domain).
- Invite link `https://squadio.techbynoam.com/<club>/join/<role>[/<team>]` opens the **app** directly
  (no browser/manifest/PWA), the app reads club+role+team and runs the right registration, then stores
  the membership under that club. Links already use this path form on web.
- Cold-start entry when opened without an invite: club selector + "enter with invite link / code".
  Optional short **club code** (e.g. `FCR-7Q2`) for manual entry when a link isn't handy.

### 4. Push (APNs + FCM)
- `@capacitor/push-notifications` registers the device and yields a native token.
- Server: send to APNs (iOS) and FCM (Android) alongside the current `web-push`. The
  `push_subscriptions` table gains a token type + platform; broadcast picks the right channel.
- Removes the iOS web-push unreliability and the cross-origin dedupe headaches (native token is
  stable per install).

### 5. Branding per club (in-app)
- Splash, header logo, theme color driven by the active club's config (already in the DB/registry).

---

## Phased delivery

### Phase 0 — Scaffolding & a test APK (this branch, now)
- Add Capacitor + Android platform. Config, app id `com.squadio.app`, name "Squadio".
- First test APK is a **shell that loads the live web app** (Capacitor `server.url`), so the app runs
  as an installed Android app for immediate local testing. (Android WebView storage already persists,
  so even this is better than the iOS PWA.)
- Deliverable: `android/` Gradle project + a debug APK buildable with one command / Android Studio.

### Phase 1 — Bundled web + API base
- Switch to bundling `dist` and route all API calls through `apiFetch` with `API_BASE`.
- Native identity store via Preferences; multi-club membership list + club switcher.

### Phase 2 — Deep links (invite opens the app)
- Universal/App Links + `apple-app-site-association` / `assetlinks.json`.
- Invite flow opens the app with club+role+team; registration stores the membership.

### Phase 3 — Native push
- APNs + FCM registration; server send to both channels; migrate broadcast/targeting.

### Phase 4 — iOS target + store submissions
- Add the iOS platform (needs macOS/Xcode or a cloud build — Codemagic/Appflow/EAS).
- Icons, splash, screenshots, privacy policy, store listings; review cycles.

---

## Accounts, tooling, costs
- Apple Developer Program — **$99/yr** (required for iOS build/distribution + APNs).
- Google Play Developer — **$25 one-time**.
- Android build: Android SDK + JDK (Java 21 already present here). iOS build: **macOS + Xcode** or a
  cloud macOS build service.
- Ongoing: native-shell changes go through store review (days); web-content changes ship OTA.

## How to build the test APK locally (Phase 0)
1. Install Android Studio (bundles the Android SDK) or the command-line SDK.
2. From the repo: `npm install` → `npm run build` → `npx cap sync android`.
3. Open `android/` in Android Studio and Run, **or** `cd android && ./gradlew assembleDebug`
   → APK at `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Install on a device/emulator to test.
