// Store identities for the single Squadio native app (one app serves every club — see the native
// plan) and helpers for building a "smart link".

export const ANDROID_APP_ID = 'com.squadio.app';
export const IOS_APP_ID = '6819670888';

// Live product origin for shareable smart links. A smart link is global — the code resolves to its
// own club — so a manager shares the same origin regardless of which club subdomain they're on.
export const SMART_LINK_ORIGIN = 'https://squadio.techbynoam.com';

// One link per team: squadio.techbynoam.com/s/<code>. Opening it routes to the app / store / browser.
export const smartLink = (code) => `${SMART_LINK_ORIGIN}/s/${encodeURIComponent(code)}`;

// Play Store link. `referrer` rides along and is delivered to the app after install via Android's
// Install Referrer API (reading it needs the native plugin in the app build; the web sets it anyway).
export const playStoreUrl = (referrer) =>
    `https://play.google.com/store/apps/details?id=${ANDROID_APP_ID}` +
    (referrer ? `&referrer=${encodeURIComponent(referrer)}` : '');

// App Store link. iOS passes NO install referrer (Apple), so context is recovered from the code the
// smart-link page shows (entered on /:club/code after install) — our guaranteed cross-platform path.
export const appStoreUrl = () => `https://apps.apple.com/app/id${IOS_APP_ID}`;
