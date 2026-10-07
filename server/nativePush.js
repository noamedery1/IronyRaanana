// Native push for the bundled store apps (Android/iOS), via Firebase Cloud Messaging HTTP v1.
//
// Why this exists: a WebView can't receive Web Push, so the native Squadio app registers for FCM
// (which also routes APNs for iOS) and hands its device token to the server. The server then delivers
// the SAME training-update notifications to native devices, alongside Web Push, from broadcast().
//
// FULLY ADDITIVE / SAFE BY DESIGN:
//   • Token registration always works (stores a row) — harmless, zero effect on the live web system.
//   • DELIVERY is gated by env: it only fires when NATIVE_PUSH_ENABLED is truthy AND a service account
//     is configured (FCM_SERVICE_ACCOUNT_JSON). Until then every send path is a silent no-op, so the
//     existing Web Push behaviour is completely unchanged.
//   • No new npm dependency: the service-account JWT is signed with Node's built-in crypto.
//
// Railway setup to turn it on (later, deliberately):
//   FCM_SERVICE_ACCOUNT_JSON = the full service-account JSON (one line) for Firebase project squadio-10636
//   NATIVE_PUSH_ENABLED      = true
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { pool } from './db.js';
import { clubId } from './people.js';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

// Parse the service account once at module load. Missing/invalid => native delivery stays off (but
// registration still stores tokens, so they accumulate and start delivering the moment it's set).
let serviceAccount = null;
try {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (raw && raw.trim()) {
        serviceAccount = JSON.parse(raw);
        if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
            console.error('[native-push] FCM_SERVICE_ACCOUNT_JSON missing client_email/private_key/project_id — delivery disabled');
            serviceAccount = null;
        }
    }
} catch (e) {
    console.error('[native-push] FCM_SERVICE_ACCOUNT_JSON is not valid JSON — delivery disabled:', e.message);
    serviceAccount = null;
}

const envEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.NATIVE_PUSH_ENABLED || '').toLowerCase());

// ===== APNs (direct) — for iOS device tokens from @capacitor/push-notifications =====
// iOS hands us an APNs token (not an FCM token), so we deliver to iOS straight through APNs HTTP/2
// using the token-based auth key (.p8). Android keeps going through FCM — sendNative routes by the
// stored `platform`. Gated by env exactly like FCM: with no APNS_* vars every iOS send is a no-op,
// so this is fully additive and never affects Android or the live web.
const APNS_KEY_P8 = process.env.APNS_KEY_P8 || '';
const APNS_KEY_ID = (process.env.APNS_KEY_ID || '').trim();
const APNS_TEAM_ID = (process.env.APNS_TEAM_ID || '').trim();
const APNS_BUNDLE = (process.env.APNS_BUNDLE || 'com.techbynoam.squadio').trim();
// A token-based auth key works for both environments; TestFlight + App Store builds use production APNs.
const APNS_HOST = (process.env.APNS_HOST || 'api.push.apple.com').trim();

function apnsConfigured() {
    return Boolean(APNS_KEY_P8 && APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE);
}

// Provider JWT (ES256), cached and refreshed well within Apple's 20–60 minute window.
let apnsJwt = null; // { token, iat }
function apnsAuthToken() {
    const now = Math.floor(Date.now() / 1000);
    if (apnsJwt && now - apnsJwt.iat < 45 * 60) return apnsJwt.token;
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }));
    const claim = base64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }));
    const signingInput = `${header}.${claim}`;
    const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key: APNS_KEY_P8, dsaEncoding: 'ieee-p1363' });
    apnsJwt = { token: `${signingInput}.${base64url(sig)}`, iat: now };
    return apnsJwt.token;
}

// Deliver to a batch of iOS tokens over ONE HTTP/2 connection. Returns { sent, failed, invalid[] }.
function sendApnsBatch(rows, { title, body, link }) {
    return new Promise((resolve) => {
        const result = { sent: 0, failed: 0, invalid: [] };
        let authToken;
        try { authToken = apnsAuthToken(); } catch { result.failed = rows.length; resolve(result); return; }
        let client;
        try { client = http2.connect(`https://${APNS_HOST}`); } catch { result.failed = rows.length; resolve(result); return; }
        let settled = false;
        const finish = () => { if (settled) return; settled = true; try { client.close(); } catch { /* */ } resolve(result); };
        client.on('error', () => { result.failed = rows.length - result.sent - result.failed; finish(); });
        const payload = JSON.stringify({
            aps: { alert: { title: title || 'הודעה מהמועדון', body: body || '' }, sound: 'default' },
            url: link || '',
        });
        let pending = rows.length;
        const done = () => { if (--pending <= 0) finish(); };
        rows.forEach((row) => {
            let status = 0, data = '';
            const req = client.request({
                ':method': 'POST',
                ':path': `/3/device/${row.token}`,
                authorization: `bearer ${authToken}`,
                'apns-topic': APNS_BUNDLE,
                'apns-push-type': 'alert',
                'apns-priority': '10',
                'content-type': 'application/json',
            });
            req.on('response', (h) => { status = h[':status']; });
            req.on('data', (c) => { data += c; });
            req.on('end', () => {
                if (status === 200) result.sent++;
                else {
                    result.failed++;
                    if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(data))) result.invalid.push(row.token);
                }
                done();
            });
            req.on('error', () => { result.failed++; done(); });
            req.setTimeout(10000, () => { try { req.close(); } catch { /* */ } });
            req.end(payload);
        });
    });
}

// Delivery happens only when explicitly enabled AND we have credentials to send with (FCM or APNs).
export function nativeDeliveryEnabled() {
    return Boolean(envEnabled && (serviceAccount || apnsConfigured()));
}

// ===== OAuth2 access token (service account → bearer), cached until shortly before expiry =====
let cachedToken = null; // { token, exp } (exp = epoch seconds)

function base64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
    if (!serviceAccount) return null;
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: FCM_SCOPE,
        aud: serviceAccount.token_uri || DEFAULT_TOKEN_URI,
        iat: now,
        exp: now + 3600,
    }));
    const signingInput = `${header}.${claim}`;
    const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), serviceAccount.private_key));
    const assertion = `${signingInput}.${signature}`;

    const res = await fetch(serviceAccount.token_uri || DEFAULT_TOKEN_URI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`token exchange failed ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
    return cachedToken.token;
}

// ===== Token registration =====
// Accepts BOTH client payload shapes already in the codebase:
//   launcher (native-shell/index.html): { token, segment, platform, role, team, label }
//   in-app  (src/nativePush.js):        { deviceToken, userToken, platform, role, team }
// `segment` wins if provided; otherwise it's derived from role/team to match Web Push segments
// (operator → __OPERATOR__ · member+team → team:<name> · else '' = whole club).
export async function registerNativeToken(slug, body = {}) {
    const token = (body.token || body.deviceToken || '').trim();
    if (!token) throw new Error('Missing device token');
    const cid = await clubId(slug);

    let segment = body.segment;
    if (segment == null) {
        const role = (body.role || '').toLowerCase();
        if (role === 'operator') segment = '__OPERATOR__';
        else if (role === 'member' && body.team) segment = 'team:' + body.team;
        else segment = '';
    }

    await pool.query(
        `INSERT INTO native_push_tokens (club_id, token, segment, platform, label, host, user_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (token) DO UPDATE SET
           club_id=excluded.club_id, segment=excluded.segment, platform=excluded.platform,
           host=COALESCE(excluded.host, native_push_tokens.host),
           label=COALESCE(NULLIF(excluded.label,''), native_push_tokens.label),
           user_token=COALESCE(NULLIF(excluded.user_token,''), native_push_tokens.user_token),
           updated_at=now()`,
        [cid, token, (segment || '').toString(), (body.platform || '').toString() || null,
            (body.label || body.name || '').trim() || null, (body.host || '').toString() || null,
            (body.userToken || '').toString() || null],
    );
    return { ok: true };
}

export async function unregisterNativeToken(slug, { token, deviceToken } = {}) {
    const t = (token || deviceToken || '').trim();
    if (!t) return { ok: true, removed: 0 };
    const r = await pool.query('DELETE FROM native_push_tokens WHERE token=$1', [t]);
    return { ok: true, removed: r.rowCount };
}

// Rows whose stored segment matches the target segment — same rules as notify.broadcast() so native
// and Web Push reach exactly the same audience. '' = whole club; 'team:X' matches a device's
// multi-team line; '__TRAINER__'/'__OPERATOR__' match by literal prefix.
async function matchingTokens(cid, seg) {
    if (seg.startsWith('team:')) {
        const name = seg.slice(5);
        const escLike = (x) => x.replace(/[%_\\]/g, '\\$&');
        const wholeLine = '%\n' + escLike('team:' + name) + '\n%';
        const r = await pool.query(
            `SELECT id, token, platform FROM native_push_tokens
             WHERE club_id=$1 AND (
                 (chr(10) || segment || chr(10)) LIKE $2
                 OR segment = $3
                 OR segment LIKE $4
             )`,
            [cid, wholeLine, name, escLike(name) + ' - %'],
        );
        return r.rows;
    }
    const r = await pool.query(
        `SELECT id, token, platform FROM native_push_tokens
         WHERE club_id=$1 AND left(segment, length($2)) = $2`,
        [cid, seg],
    );
    return r.rows;
}

// Deliver one notification to every native device in a segment. No-op (returns skipped) unless
// delivery is enabled + configured, so calling this from broadcast() is always safe.
export async function sendNative(slug, { segment = '', title, body, url, data, tag } = {}) {
    if (!nativeDeliveryEnabled()) return { skipped: true, sent: 0, failed: 0 };
    let cid;
    try { cid = await clubId(slug); } catch { return { skipped: true, sent: 0, failed: 0 }; }
    const seg = (segment || '').toString();

    let rows;
    try { rows = await matchingTokens(cid, seg); } catch { return { skipped: true, sent: 0, failed: 0 }; }
    if (!rows.length) return { sent: 0, failed: 0, note: 'no native tokens' };

    const link = url || `/${slug}`;
    const iosRows = rows.filter((r) => (r.platform || '').toLowerCase() === 'ios');
    const fcmRows = rows.filter((r) => (r.platform || '').toLowerCase() !== 'ios');

    let sent = 0, failed = 0;
    const invalid = [];

    // ---- iOS: direct APNs over one HTTP/2 connection (tokens are APNs device tokens, not FCM) ----
    if (iosRows.length) {
        if (apnsConfigured()) {
            const r = await sendApnsBatch(iosRows, { title, body, link });
            sent += r.sent; failed += r.failed; invalid.push(...r.invalid);
        } else {
            failed += iosRows.length; // APNs not configured — iOS stays a no-op, Android unaffected
        }
    }

    // ---- Android (+ any non-iOS): FCM HTTP v1 (unchanged behaviour) ----
    if (fcmRows.length) {
        let accessToken = null;
        if (serviceAccount) { try { accessToken = await getAccessToken(); } catch { accessToken = null; } }
        if (!accessToken) {
            failed += fcmRows.length;
        } else {
            const endpoint = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
            // FCM data values must be strings.
            const dataObj = {};
            Object.entries(data || {}).forEach(([k, v]) => { dataObj[k] = typeof v === 'string' ? v : JSON.stringify(v); });
            dataObj.url = link;
            await Promise.all(fcmRows.map(async (row) => {
                const message = {
                    token: row.token,
                    notification: { title: title || 'הודעה מהמועדון', body: body || '' },
                    data: dataObj,
                    android: { priority: 'HIGH', notification: { tag: tag || undefined, default_sound: true } },
                    apns: { payload: { aps: { sound: 'default' } } },
                };
                try {
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message }),
                    });
                    if (res.ok) { sent++; return; }
                    failed++;
                    // 404 UNREGISTERED / 400 INVALID_ARGUMENT => the token is dead; drop it.
                    if (res.status === 404 || res.status === 400) invalid.push(row.token);
                } catch { failed++; }
            }));
        }
    }

    if (invalid.length) {
        try { await pool.query('DELETE FROM native_push_tokens WHERE token = ANY($1)', [invalid]); } catch { /* ignore */ }
    }
    return { sent, failed, dropped: invalid.length };
}

// Diagnostics for /api/health — never exposes secrets.
export async function nativePushDiag() {
    const out = {
        deliveryEnabled: nativeDeliveryEnabled(),
        envEnabled,
        serviceAccountLoaded: Boolean(serviceAccount),
        projectId: serviceAccount ? serviceAccount.project_id : null,
        apnsConfigured: apnsConfigured(),
        tokens: null,
    };
    try {
        const r = await pool.query('SELECT count(*)::int n FROM native_push_tokens');
        out.tokens = r.rows[0].n;
    } catch { /* table may not exist yet */ }
    return out;
}
