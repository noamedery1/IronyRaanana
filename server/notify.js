// Push subscriptions + delivery, email subscribers, feedback — all in the DB.
import webpush from 'web-push';
import { pool } from './db.js';
import { clubId } from './people.js';
import { getSetting, setSetting } from './settings.js';
import { sendNative } from './nativePush.js';

// IMPORTANT: this fallback MUST match the public key the client subscribes with (src/push.js)
// and server.js. Previously this had no fallback, so if the env var was unset the manager's
// broadcast path silently couldn't send (pushReady=false) even though /api/health said push was
// ready (health reflects server.js, a separate web-push instance).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
    || 'BHRSmWUH9tdilK-Xh31VGoEMGb9jMZayZSk8znHbbPz-1ZdNswqttSUjXWEBrxsgg5KmEqT8xgm5s-QqPG5RCcw';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noam.edery@tibaparking.com';
const pushReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Diagnostics for /api/health — confirms the BROADCAST path (this module) can actually send,
// and lets us compare the effective public key against the client's without exposing secrets.
export async function pushDiag() {
    const tail = VAPID_PUBLIC_KEY ? VAPID_PUBLIC_KEY.slice(-10) : null;
    const out = { broadcastReady: pushReady, publicKeyTail: tail, usingEnvPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY), subscriptions: null, bySegment: null };
    try {
        const r = await pool.query('SELECT count(*)::int n FROM push_subscriptions');
        out.subscriptions = r.rows[0].n;
        const seg = await pool.query("SELECT coalesce(segment,'') seg, count(*)::int n FROM push_subscriptions GROUP BY 1 ORDER BY 2 DESC LIMIT 20");
        out.bySegment = seg.rows;
    } catch { /* table may not exist yet */ }
    return out;
}

// ===== Push subscriptions =====
// `host` = the origin the device subscribed on (apex vs a club's subdomain). Stored so a club that
// moved to its own subdomain can deliver only to the subdomain's subscriptions and drop the stale
// duplicate the same device left on the old apex origin (two origins ⇒ two endpoints ⇒ two pushes).
export async function registerPush(slug, { segment, subscription, host, label }) {
    if (!subscription || !subscription.endpoint) throw new Error('Missing subscription');
    const cid = await clubId(slug);
    // label = the registrant's name (so the manager can identify a device). On a re-register that
    // sends no name, keep the previously stored one rather than blanking it.
    await pool.query(
        `INSERT INTO push_subscriptions (club_id, segment, endpoint, subscription, host, label)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (endpoint) DO UPDATE SET
           club_id=excluded.club_id, segment=excluded.segment, subscription=excluded.subscription,
           host=excluded.host,
           label=COALESCE(NULLIF(excluded.label,''), push_subscriptions.label)`,
        [cid, segment || '', subscription.endpoint, subscription, host || null, (label || '').trim() || null],
    );
    return { ok: true };
}

export async function unregisterPush(slug, { endpoint }) {
    if (!endpoint) return { ok: true, removed: 0 };
    const r = await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
    return { ok: true, removed: r.rowCount };
}

// Deliver to a segment. '' = whole club; 'team:X' / '__TRAINER__:X' / '__OPERATOR__' match
// exactly or by prefix (so '__TRAINER__' hits every '__TRAINER__:name').
export async function broadcast(slug, { segment = '', title, body, url, icon, tag, data, actions, channel = 'all' }) {
    const cid = await clubId(slug);
    const seg = (segment || '').toString();
    // channel: 'all' (web + native, default) · 'native' (store apps only — manager testing, so a test
    // push doesn't reach real web users) · 'web' (web only). Fully backward compatible (omit = 'all').
    const wantWeb = channel !== 'native';
    const wantNative = channel !== 'web';
    // Deliver to EVERY matching subscription regardless of which origin (apex vs subdomain) it was
    // registered on. We deliberately do NOT auto-drop by origin: an active parent who only installed
    // the old apex app would silently stop getting notifications, and origin can't distinguish a
    // real second device from a stale duplicate. Duplicates (same person on two origins) are cleaned
    // up by hand in the manager's "מנויי פוש" screen, which shows each device's name to decide.
    // Match the target's subscriptions. A team target (team:<name>) must also reach rows stored
    // in the legacy label format ("<name> - <coach>" or bare "<name>") that the notifications
    // modal used to create — otherwise team sends silently skip those parents.
    let r = { rows: [] };
    if (wantWeb && seg.startsWith('team:')) {
        const name = seg.slice(5);
        const escLike = (x) => x.replace(/[%_\\]/g, '\\$&');
        // A device subscribes to all its teams as one "team:<name>" per line. Match this team as a
        // WHOLE line (wrapping the stored segment in newlines) so it hits single- and multi-team
        // devices without false matches on longer names (e.g. "ילדים ג'" ≠ "ילדים ג' צפון").
        const wholeLine = '%\n' + escLike('team:' + name) + '\n%';
        r = await pool.query(
            `SELECT id, endpoint, subscription FROM push_subscriptions
             WHERE club_id=$1 AND (
                 (chr(10) || segment || chr(10)) LIKE $2
                 OR segment = $3
                 OR segment LIKE $4
             )`,
            [cid, wholeLine, name, escLike(name) + ' - %'],
        );
    } else if (wantWeb) {
        // Literal prefix match (avoid LIKE: '_' in '__TRAINER' is a wildcard).
        r = await pool.query(
            `SELECT id, endpoint, subscription FROM push_subscriptions
             WHERE club_id=$1 AND left(segment, length($2)) = $2`,
            [cid, seg],
        );
    }
    // Prefix the club name so the recipient always knows WHICH club sent it — on a phone with more
    // than one club installed from this domain, Android may show the other club's app icon/name
    // (shared origin = shared notification identity), so the club name in the title disambiguates.
    let clubName = '';
    try { clubName = (await pool.query('SELECT name FROM clubs WHERE id=$1', [cid])).rows[0]?.name || ''; } catch { /* ignore */ }
    const baseTitle = title || 'הודעה מהמועדון';
    const fullTitle = clubName && !baseTitle.includes(clubName) ? `${clubName} · ${baseTitle}` : baseTitle;
    const link = url || `/${slug}`;

    // Native (store-app) delivery runs in PARALLEL with Web Push and is fully independent: it's a
    // no-op unless enabled+configured, and any failure is swallowed so it can never affect the Web
    // Push result or the caller. Fired here (not after the early-returns below) so a native-only
    // audience — a device with no Web Push subscription — still receives the notification.
    const nativePromise = wantNative
        ? sendNative(slug, { segment: seg, title: fullTitle, body, url: link, data, tag })
            .catch((e) => ({ skipped: true, error: e && e.message }))
        : Promise.resolve({ skipped: true, reason: 'channel=web' });

    const withNative = async (webResult) => ({ ...webResult, native: await nativePromise });

    if (!wantWeb) return withNative({ sent: 0, failed: 0, expired: [], note: 'native-only (channel)' });
    if (!r.rows.length) return withNative({ sent: 0, failed: 0, expired: [], note: 'no subscribers' });
    if (!pushReady) return withNative({ sent: 0, failed: r.rows.length, expired: [], error: 'push not configured (set VAPID_* env)' });

    const payload = JSON.stringify({
        title: fullTitle, body: body || '',
        // Default to the CLUB's own icon (football/basketball per club) rather than the built-in
        // basketball app icon, so a football club's push doesn't show a basketball.
        url: link, icon: icon || `/api/${slug}/icon/192`,
        tag: tag || undefined,
        data: data || {}, actions: actions || [],
    });
    let sent = 0, failed = 0;
    const expired = [];
    const statusCodes = {}; // for diagnosis: 403 = VAPID key mismatch, etc.
    await Promise.all(r.rows.map(async (row) => {
        try { await webpush.sendNotification(row.subscription, payload); sent++; }
        catch (e) {
            failed++;
            const sc = e.statusCode || 'err';
            statusCodes[sc] = (statusCodes[sc] || 0) + 1;
            if (e.statusCode === 404 || e.statusCode === 410) expired.push(row.endpoint);
        }
    }));
    if (expired.length) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [expired]);
    return withNative({ sent, failed, expired, statusCodes });
}

// ===== Message archive (manager broadcasts) =====
// Stored in club_settings (key 'pushLog') as a capped array — no separate table needed. Each
// entry records what was sent so the manager can review it later or resend it.
const PUSH_LOG_KEY = 'pushLog';
const PUSH_LOG_MAX = 100;

// Send one manager message to one or more segments, aggregate the result, and archive it.
export async function sendMessage(slug, { title, body, target, segments, channel = 'all' }) {
    const segs = Array.isArray(segments) && segments.length ? segments : [''];
    let sent = 0, failed = 0;
    const statusCodes = {};
    let nativeSent = 0, nativeFailed = 0;
    for (const seg of segs) {
        const r = await broadcast(slug, { segment: seg, title, body, channel });
        sent += r.sent || 0;
        failed += r.failed || 0;
        Object.entries(r.statusCodes || {}).forEach(([k, v]) => { statusCodes[k] = (statusCodes[k] || 0) + v; });
        if (r.native) { nativeSent += r.native.sent || 0; nativeFailed += r.native.failed || 0; }
    }
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: new Date().toISOString(),
        target: target || '', segments: segs,
        title: title || '', body: body || '',
        sent, failed, channel,
        nativeSent, nativeFailed,
    };
    const existing = await getSetting(slug, PUSH_LOG_KEY);
    const arr = Array.isArray(existing) ? existing : [];
    arr.unshift(entry);
    await setSetting(slug, PUSH_LOG_KEY, arr.slice(0, PUSH_LOG_MAX));
    return { sent, failed, statusCodes, nativeSent, nativeFailed, entry };
}

export async function listMessages(slug) {
    const existing = await getSetting(slug, PUSH_LOG_KEY);
    return { messages: Array.isArray(existing) ? existing : [] };
}

// Subscriber counts per segment for a club — so the manager can see, before sending, how many
// devices will actually receive a message for each target (0 = nobody enabled notifications yet).
export async function pushStats(slug) {
    const cid = await clubId(slug);
    // Count every subscription that would receive a send (all origins). This can include a device's
    // duplicate across origins; the manager reconciles those by name in the "מנויי פוש" screen.
    const r = await pool.query("SELECT coalesce(segment,'') seg, count(*)::int n FROM push_subscriptions WHERE club_id=$1 GROUP BY 1", [cid]);
    const bySegment = {};
    let total = 0;
    r.rows.forEach((x) => { bySegment[x.seg] = x.n; total += x.n; });
    return { total, bySegment };
}

// ===== Device subscriptions (manager cleanup) =====
// List the raw per-device subscriptions for a club so the manager can remove stale/duplicate ones
// (e.g. an old apex registration left behind after moving to a subdomain). Returns only what
// identifies a device — segment, host/origin, a short endpoint tail, when it was added — never the
// push keys. `activeHost` (the club's current origin, if it has a subdomain) flags legacy rows.
export async function listSubscriptions(slug, activeHost = null) {
    const cid = await clubId(slug);
    const r = await pool.query(
        "SELECT id, coalesce(segment,'') segment, host, label, endpoint, created_at FROM push_subscriptions WHERE club_id=$1 ORDER BY created_at DESC",
        [cid],
    );
    const subscriptions = r.rows.map((x) => ({
        id: x.id,
        name: x.label || null, // registrant's name, if we captured it
        segment: x.segment,
        host: x.host || null,
        endpointTail: (x.endpoint || '').slice(-14),
        createdAt: x.created_at,
        legacy: Boolean(activeHost) && x.host !== activeHost, // not on the club's current origin
    }));
    return { subscriptions, activeHost: activeHost || null, total: subscriptions.length };
}

export async function deleteSubscription(slug, id) {
    const cid = await clubId(slug);
    const r = await pool.query('DELETE FROM push_subscriptions WHERE club_id=$1 AND id=$2', [cid, id]);
    return { ok: true, removed: r.rowCount };
}

// Remove every subscription for this club that is NOT on its current origin — the stale apex
// duplicates left behind after moving to a subdomain. No-op for a club without a subdomain.
export async function purgeLegacySubscriptions(slug, activeHost = null) {
    if (!activeHost) return { ok: true, removed: 0, note: 'club has no subdomain — nothing to purge' };
    const cid = await clubId(slug);
    const r = await pool.query('DELETE FROM push_subscriptions WHERE club_id=$1 AND host IS DISTINCT FROM $2', [cid, activeHost]);
    return { ok: true, removed: r.rowCount };
}

// ===== Email subscribers =====
export async function addEmailSubscriber(slug, { team, name, email }) {
    if (!email) throw new Error('Missing email');
    const cid = await clubId(slug);
    await pool.query(
        `INSERT INTO email_subscribers (club_id, team, name, email) VALUES ($1,$2,$3,$4)
         ON CONFLICT (club_id, lower(email), coalesce(team,'')) DO NOTHING`,
        [cid, team || '', name || '', email],
    );
    return { ok: true };
}

export async function removeEmailSubscriber(slug, { email, team }) {
    const cid = await clubId(slug);
    const r = team
        ? await pool.query('DELETE FROM email_subscribers WHERE club_id=$1 AND lower(email)=lower($2) AND team=$3', [cid, email, team])
        : await pool.query('DELETE FROM email_subscribers WHERE club_id=$1 AND lower(email)=lower($2)', [cid, email]);
    return { ok: true, removed: r.rowCount };
}

// ===== Feedback =====
export async function saveFeedback(slug, { name, email, message }) {
    if (!message || !message.trim()) throw new Error('Empty message');
    let cid = null;
    try { cid = await clubId(slug); } catch { /* feedback can be club-less */ }
    await pool.query('INSERT INTO feedback (club_id, name, email, message) VALUES ($1,$2,$3,$4)', [cid, name || '', email || '', message]);
    return { ok: true };
}
