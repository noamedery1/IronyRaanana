// Push subscriptions + delivery, email subscribers, feedback — all in the DB.
import webpush from 'web-push';
import { pool } from './db.js';
import { clubId } from './people.js';
import { getSetting, setSetting } from './settings.js';

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
export async function registerPush(slug, { segment, subscription }) {
    if (!subscription || !subscription.endpoint) throw new Error('Missing subscription');
    const cid = await clubId(slug);
    await pool.query(
        `INSERT INTO push_subscriptions (club_id, segment, endpoint, subscription)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (endpoint) DO UPDATE SET club_id=excluded.club_id, segment=excluded.segment, subscription=excluded.subscription`,
        [cid, segment || '', subscription.endpoint, subscription],
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
export async function broadcast(slug, { segment = '', title, body, url, icon, tag, data, actions }) {
    const cid = await clubId(slug);
    const seg = (segment || '').toString();
    // Match the target's subscriptions. A team target (team:<name>) must also reach rows stored
    // in the legacy label format ("<name> - <coach>" or bare "<name>") that the notifications
    // modal used to create — otherwise team sends silently skip those parents.
    let r;
    if (seg.startsWith('team:')) {
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
    } else {
        // Literal prefix match (avoid LIKE: '_' in '__TRAINER' is a wildcard).
        r = await pool.query(
            `SELECT id, endpoint, subscription FROM push_subscriptions
             WHERE club_id=$1 AND left(segment, length($2)) = $2`,
            [cid, seg],
        );
    }
    if (!r.rows.length) return { sent: 0, failed: 0, expired: [], note: 'no subscribers' };
    if (!pushReady) return { sent: 0, failed: r.rows.length, expired: [], error: 'push not configured (set VAPID_* env)' };

    const payload = JSON.stringify({
        title: title || 'הודעה מהמועדון', body: body || '',
        // Default to the CLUB's own icon (football/basketball per club) rather than the built-in
        // basketball app icon, so a football club's push doesn't show a basketball.
        url: url || `/${slug}`, icon: icon || `/api/${slug}/icon/192`,
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
    return { sent, failed, expired, statusCodes };
}

// ===== Message archive (manager broadcasts) =====
// Stored in club_settings (key 'pushLog') as a capped array — no separate table needed. Each
// entry records what was sent so the manager can review it later or resend it.
const PUSH_LOG_KEY = 'pushLog';
const PUSH_LOG_MAX = 100;

// Send one manager message to one or more segments, aggregate the result, and archive it.
export async function sendMessage(slug, { title, body, target, segments }) {
    const segs = Array.isArray(segments) && segments.length ? segments : [''];
    let sent = 0, failed = 0;
    const statusCodes = {};
    for (const seg of segs) {
        const r = await broadcast(slug, { segment: seg, title, body });
        sent += r.sent || 0;
        failed += r.failed || 0;
        Object.entries(r.statusCodes || {}).forEach(([k, v]) => { statusCodes[k] = (statusCodes[k] || 0) + v; });
    }
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: new Date().toISOString(),
        target: target || '', segments: segs,
        title: title || '', body: body || '',
        sent, failed,
    };
    const existing = await getSetting(slug, PUSH_LOG_KEY);
    const arr = Array.isArray(existing) ? existing : [];
    arr.unshift(entry);
    await setSetting(slug, PUSH_LOG_KEY, arr.slice(0, PUSH_LOG_MAX));
    return { sent, failed, statusCodes, entry };
}

export async function listMessages(slug) {
    const existing = await getSetting(slug, PUSH_LOG_KEY);
    return { messages: Array.isArray(existing) ? existing : [] };
}

// Subscriber counts per segment for a club — so the manager can see, before sending, how many
// devices will actually receive a message for each target (0 = nobody enabled notifications yet).
export async function pushStats(slug) {
    const cid = await clubId(slug);
    const r = await pool.query("SELECT coalesce(segment,'') seg, count(*)::int n FROM push_subscriptions WHERE club_id=$1 GROUP BY 1", [cid]);
    const bySegment = {};
    let total = 0;
    r.rows.forEach((x) => { bySegment[x.seg] = x.n; total += x.n; });
    return { total, bySegment };
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
