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

// Delivery happens only when explicitly enabled AND we actually have credentials to send with.
export function nativeDeliveryEnabled() {
    return Boolean(envEnabled && serviceAccount);
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
            `SELECT id, token FROM native_push_tokens
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
        `SELECT id, token FROM native_push_tokens
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

    let accessToken;
    try { accessToken = await getAccessToken(); } catch (e) { return { sent: 0, failed: rows.length, error: e.message }; }
    if (!accessToken) return { sent: 0, failed: rows.length, error: 'no access token' };

    const endpoint = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const link = url || `/${slug}`;
    // FCM data values must be strings.
    const dataObj = {};
    Object.entries(data || {}).forEach(([k, v]) => { dataObj[k] = typeof v === 'string' ? v : JSON.stringify(v); });
    dataObj.url = link;

    let sent = 0, failed = 0;
    const invalid = [];
    await Promise.all(rows.map(async (row) => {
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
            if (res.status === 404 || res.status === 400) {
                invalid.push(row.token);
            }
        } catch { failed++; }
    }));
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
        tokens: null,
    };
    try {
        const r = await pool.query('SELECT count(*)::int n FROM native_push_tokens');
        out.tokens = r.rows[0].n;
    } catch { /* table may not exist yet */ }
    return out;
}
