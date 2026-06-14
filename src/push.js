// Web Push subscription helper (client side).
// Asks for notification permission, subscribes via the service worker's PushManager,
// and registers the subscription with the backend (stored per-team in the Google Sheet).

// Public VAPID key — safe to ship to the client. The matching private key lives only on the server.
const VAPID_PUBLIC_KEY = 'BHRSmWUH9tdilK-Xh31VGoEMGb9jMZayZSk8znHbbPz-1ZdNswqttSUjXWEBrxsgg5KmEqT8xgm5s-QqPG5RCcw';

export function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
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

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
    }

    const res = await fetch(sheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'registerPushSubscription',
            team,
            subscription: sub.toJSON(),
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) return { ok: false, reason: data.error };

    return { ok: true };
}
