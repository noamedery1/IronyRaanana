// Push subscriptions + delivery, email subscribers, feedback — all in the DB.
import webpush from 'web-push';
import { pool } from './db.js';
import { clubId } from './people.js';

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
         ON CONFLICT (endpoint) DO UPDATE SET segment=excluded.segment, subscription=excluded.subscription`,
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
    // Literal prefix match (avoid LIKE: '_' in '__TRAINER' is a wildcard).
    const r = await pool.query(
        `SELECT id, endpoint, subscription FROM push_subscriptions
         WHERE club_id=$1 AND left(segment, length($2)) = $2`,
        [cid, seg],
    );
    if (!r.rows.length) return { sent: 0, failed: 0, expired: [], note: 'no subscribers' };
    if (!pushReady) return { sent: 0, failed: r.rows.length, expired: [], error: 'push not configured (set VAPID_* env)' };

    const payload = JSON.stringify({
        title: title || 'הודעה מהמועדון', body: body || '',
        url: url || `/${slug}`, icon: icon || '/pwa-192x192.png',
        tag: tag || undefined,
        data: data || {}, actions: actions || [],
    });
    let sent = 0, failed = 0;
    const expired = [];
    await Promise.all(r.rows.map(async (row) => {
        try { await webpush.sendNotification(row.subscription, payload); sent++; }
        catch (e) {
            failed++;
            if (e.statusCode === 404 || e.statusCode === 410) expired.push(row.endpoint);
        }
    }));
    if (expired.length) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [expired]);
    return { sent, failed, expired };
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
