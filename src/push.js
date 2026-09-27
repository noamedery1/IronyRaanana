// Web Push subscription helper (client side).
// Asks for notification permission, subscribes via the service worker's PushManager,
// and registers the subscription with the backend (stored per-team in the Google Sheet).

import { getActiveClub } from './clubConfig.js';

// Public VAPID key — safe to ship to the client. The matching private key lives only on the server.
// Dev override (VITE_VAPID_PUBLIC_KEY) lets local push match the local server keypair.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
    || 'BHRSmWUH9tdilK-Xh31VGoEMGb9jMZayZSk8znHbbPz-1ZdNswqttSUjXWEBrxsgg5KmEqT8xgm5s-QqPG5RCcw';

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Is the app running as an INSTALLED PWA (opened from the home-screen icon), rather than a
// browser tab / saved link? Push works only for the installed app on iOS, so we use this to
// decide whether to offer "enable notifications" or explain how to install first.
export function isStandalone() {
    try {
        return window.matchMedia?.('(display-mode: standalone)').matches
            || window.navigator.standalone === true; // iOS Safari home-screen flag
    } catch { return false; }
}

// iOS (incl. iPadOS reporting as MacIntel with touch) — install steps differ from Android.
export function isIOS() {
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Does an existing subscription's applicationServerKey match the key we want to use now?
// (If the browser doesn't expose it, treat as a mismatch → safest to re-subscribe with the right key.)
function subKeyMatches(sub, wantKeyU8) {
    try {
        const cur = sub.options && sub.options.applicationServerKey;
        if (!cur) return false;
        const a = new Uint8Array(cur);
        if (a.length !== wantKeyU8.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== wantKeyU8[i]) return false;
        return true;
    } catch { return false; }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
}

// Subscribes the current device to push for a given team, then persists it via Apps Script.
// Returns { ok: true } on success, or { ok: false, reason } on failure.
export async function subscribeToPush(team, sheetUrl) {
    if (!pushSupported()) return { ok: false, reason: 'unsupported' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    const reg = await navigator.serviceWorker.ready;

    const wantKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    // If an existing subscription was created with a DIFFERENT VAPID key (e.g. from an older build),
    // the server can't deliver to it (403). Drop it and re-subscribe with the current key so push
    // self-heals instead of silently never arriving.
    if (sub && !subKeyMatches(sub, wantKey)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
    }
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: wantKey,
        });
    }

    // Attach the registrant's name (if known) so the manager can see WHO each device is in the
    // subscriptions screen, not just which team/origin. Best-effort — empty for anonymous devices.
    const label = (localStorage.getItem('userName') || '').trim();
    const res = await fetch(`/api/${getActiveClub().slug}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: team, subscription: sub.toJSON(), label }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) return { ok: false, reason: data.error };

    return { ok: true };
}

// Unsubscribes this device from push and removes it from the server store.
export async function unsubscribeFromPush(sheetUrl) {
    if (!pushSupported()) return { ok: false, reason: 'unsupported' };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true }; // already not subscribed

    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    try {
        await fetch(`/api/${getActiveClub().slug}/push`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
        });
    } catch { /* best effort */ }
    return { ok: true };
}
