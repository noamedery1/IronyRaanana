// Native push (store apps). The WebView can't receive Web Push, so the bundled native app registers
// for FCM/APNs and sends its device token to the server WITH the signed-in user's identity, so the
// server can deliver the same training-update notifications via FCM (which also routes APNs for iOS).
//
// Because the app is BUNDLED (its own origin), the Capacitor bridge is available to this React code,
// so there is no separate "identity bridge" — we already know the user here.
//
// Requires Firebase config to actually get a token (google-services.json / GoogleService-Info.plist
// + APNs key). Without it this fails safe (returns {ok:false}); nothing breaks. See NATIVE_RELEASE.md.
import { isNativeApp, nativePlatform } from './nativeBridge.js';

// Register for native push and hand the token to the server. Call once after the user is identified
// (member/operator), e.g. right after a successful Join or on an authenticated schedule load.
// `segment` (preferred) is the full push segment for this device — a member's every team as
// "team:<name>" lines, or "__OPERATOR__" — matching Web Push exactly. If omitted, the server derives
// one from role/team (single team only).
export async function registerNativePush({ slug, segment, userToken, role, team }) {
    if (!isNativeApp()) return { ok: false, reason: 'web' };
    if (!slug) return { ok: false, reason: 'no-club' };

    let PushNotifications;
    try {
        ({ PushNotifications } = await import('@capacitor/push-notifications'));
    } catch {
        return { ok: false, reason: 'plugin-missing' };
    }

    try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') return { ok: false, reason: 'denied' };

        // The token arrives via the 'registration' event, not from register() itself.
        const tokenPromise = new Promise((resolve) => {
            let done = false;
            PushNotifications.addListener('registration', (t) => { if (!done) { done = true; resolve(t.value || null); } });
            PushNotifications.addListener('registrationError', () => { if (!done) { done = true; resolve(null); } });
        });
        await PushNotifications.register();
        const deviceToken = await Promise.race([
            tokenPromise,
            new Promise((r) => setTimeout(() => r(null), 8000)),
        ]);
        if (!deviceToken) return { ok: false, reason: 'no-token' };

        // Hand the token to the server. Endpoint stores it per segment (team:<name> / __OPERATOR__)
        // and sends via FCM alongside Web Push. (Server side is built together once Firebase exists.)
        await fetch(`/api/${slug}/native-push/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: nativePlatform(), deviceToken, segment: segment ?? undefined, userToken: userToken || '', role: role || '', team: team || '' }),
        }).catch(() => {});

        return { ok: true, deviceToken };
    } catch (e) {
        return { ok: false, reason: String(e && e.message || e) };
    }
}

// Optional: surface incoming pushes while the app is foregrounded (e.g. a toast / badge). Safe no-op on web.
export async function onNativePush(handler) {
    if (!isNativeApp()) return;
    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        PushNotifications.addListener('pushNotificationReceived', (n) => { try { handler?.(n); } catch { /* ignore */ } });
    } catch { /* plugin missing */ }
}
