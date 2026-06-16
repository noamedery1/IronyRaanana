// Change requests (trainer -> manager) + approval, all in the DB.
// Approval mutates the live session and pushes the affected team.
import crypto from 'crypto';
import { pool, withTx } from './db.js';
import { clubId } from './people.js';
import { broadcast } from './notify.js';
import { sendEmail } from './mailer.js';
import { getClub } from './clubsStore.js';

// Signed approve/reject links: HMAC of the request id (no extra DB column needed).
const SIGN_SECRET = process.env.REQUEST_SIGN_SECRET || process.env.PUSH_SECRET || 'dev-secret';
export const signId = (id) => crypto.createHmac('sha256', SIGN_SECRET).update(String(id)).digest('hex').slice(0, 32);
export const verifyId = (id, token) => Boolean(token) && signId(id) === token;

// Email the manager that a request arrived, with one-click approve/reject links.
async function notifyManager(slug, id, p) {
    const club = getClub(slug);
    const to = process.env.MANAGER_EMAIL || club?.managerEmail;
    if (!to) return;
    const base = process.env.APP_BASE_URL || '';
    const tok = signId(id);
    const approve = `${base}/api/${slug}/requests/${id}/approve?token=${tok}`;
    const reject = `${base}/api/${slug}/requests/${id}/reject?token=${tok}`;
    const change = p.type === 'cancel' ? 'ביטול'
        : p.type === 'move' ? `העברה ליום ${p.newDay} ${p.newTime || ''} ${p.newLocation || ''}`
            : `שינוי ל-${p.newTime || ''} ${p.newLocation || ''}`;
    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif">
        <h3>בקשת שינוי לו"ז</h3>
        <p><b>מאמן:</b> ${p.trainerName || ''} · <b>קבוצה:</b> ${p.team || ''}</p>
        <p><b>אימון:</b> ${p.day || ''} ${p.time || ''}</p>
        <p><b>מבוקש:</b> ${change}</p>
        <p><b>סיבה:</b> ${p.reason || ''}</p>
        <p style="margin-top:18px">
          <a href="${approve}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">✅ אשר</a>
          &nbsp;&nbsp;
          <a href="${reject}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">❌ דחה</a>
        </p>
      </div>`;
    await sendEmail({ to, subject: `בקשת שינוי — ${p.team || ''} (${p.trainerName || ''})`, html });
}

// Push the manager(s) with one-tap approve/reject action buttons (handled in push-sw.js).
async function pushManager(slug, id, p) {
    const base = process.env.APP_BASE_URL || '';
    const tok = signId(id);
    const change = p.type === 'cancel' ? 'ביטול'
        : p.type === 'move' ? `העברה ליום ${p.newDay || ''}`
            : `שינוי ל-${p.newTime || ''} ${p.newLocation || ''}`;
    await broadcast(slug, {
        segment: '__MANAGER__',
        title: `בקשת שינוי — ${p.team || ''}`,
        body: `${p.trainerName || ''}: ${change}`,
        url: `${base}/admin/dashboard`,
        data: {
            approveUrl: `${base}/api/${slug}/requests/${id}/approve?token=${tok}`,
            rejectUrl: `${base}/api/${slug}/requests/${id}/reject?token=${tok}`,
            label: `${p.team || ''} — ${change}`,
            url: `${base}/admin/dashboard`,
        },
        actions: [{ action: 'approve', title: '✅ אשר' }, { action: 'reject', title: '❌ דחה' }],
    });
}

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// Strip bidi control marks + normalize so day names match regardless of source encoding.
const norm = (s) => (s || '').toString().replace(/[‎‏‪-‮⁦-⁩]/g, '').normalize('NFC').trim();
const dayIndex = (d) => HEB_DAYS.findIndex((h) => norm(h) === norm(d).split(/\s+/)[0]);
const pad = (n) => String(n).padStart(2, '0');
const addMin = (hhmm, mins) => {
    const [h, m] = (hhmm || '0:0').split(':').map(Number);
    const t = ((h * 60 + m) + mins) % 1440;
    return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

async function livePub(cid) {
    const r = await pool.query(
        `SELECT id, week_start::text FROM schedule_publications WHERE club_id=$1 AND status='live' ORDER BY week_start DESC LIMIT 1`,
        [cid],
    );
    return r.rows[0] || null;
}

export async function createRequest(slug, body) {
    const { trainerName, team, day, time, type, newTime, newLocation, newDay, reason } = body || {};
    if (!team || !type) throw new Error('Missing team/type');
    const cid = await clubId(slug);
    const pub = await livePub(cid);

    let sessionId = null;
    if (pub) {
        const startHHMM = (time || '').split('-')[0].trim();
        const q = await pool.query(
            `SELECT id FROM sessions WHERE publication_id=$1 AND team=$2 AND day_of_week=$3
             ORDER BY (to_char(start_time,'HH24:MI')=$4) DESC LIMIT 1`,
            [pub.id, team, dayIndex(day), startHHMM],
        );
        if (q.rows.length) sessionId = q.rows[0].id;
    }
    const proposed = { day, time, newTime, newLocation, newDay, team };
    const r = await pool.query(
        `INSERT INTO change_requests (club_id, session_id, requested_by, type, proposed, reason, status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
        [cid, sessionId, trainerName || '', type.toString().toLowerCase(), proposed, reason || ''],
    );
    const id = r.rows[0].id;
    // notify the manager: email with signed links + push with approve/reject action buttons
    const info = { trainerName, team, day, time, type: type.toString().toLowerCase(), newTime, newLocation, newDay, reason };
    notifyManager(slug, id, info).catch(() => {});
    pushManager(slug, id, info).catch(() => {});
    return { ok: true, id };
}

export async function listRequests(slug, status = 'pending') {
    const cid = await clubId(slug);
    const r = await pool.query(
        `SELECT cr.id, cr.requested_by, cr.type, cr.proposed, cr.reason, cr.status, cr.created_at,
                s.team AS session_team, to_char(s.start_time,'HH24:MI') AS session_time, s.hall AS session_hall
         FROM change_requests cr LEFT JOIN sessions s ON s.id=cr.session_id
         WHERE cr.club_id=$1 AND ($2='all' OR cr.status=$2)
         ORDER BY cr.created_at DESC`,
        [cid, status],
    );
    return r.rows;
}

export async function rejectRequest(slug, id) {
    const cid = await clubId(slug);
    await pool.query(`UPDATE change_requests SET status='rejected', resolved_at=now() WHERE id=$1 AND club_id=$2`, [id, cid]);
    return { ok: true };
}

export async function approveRequest(slug, id) {
    const cid = await clubId(slug);
    const pub = await livePub(cid);
    return withTx(async (cx) => {
        const rq = await cx.query(`SELECT * FROM change_requests WHERE id=$1 AND club_id=$2 FOR UPDATE`, [id, cid]);
        if (!rq.rows.length) throw new Error('Request not found');
        const req = rq.rows[0];
        if (req.status !== 'pending') throw new Error('Already ' + req.status);
        const p = req.proposed || {};

        // locate the target session (stored link, else re-match in the live publication)
        let sessionId = req.session_id;
        if (!sessionId && pub) {
            const startHHMM = (p.time || '').split('-')[0].trim();
            const q = await cx.query(
                `SELECT id FROM sessions WHERE publication_id=$1 AND team=$2 AND day_of_week=$3
                 ORDER BY (to_char(start_time,'HH24:MI')=$4) DESC LIMIT 1`,
                [pub.id, p.team, dayIndex(p.day), startHHMM],
            );
            sessionId = q.rows[0]?.id || null;
        }

        let msg = '';
        if (req.type === 'cancel') {
            if (sessionId) await cx.query(`UPDATE sessions SET status='cancelled', updated_at=now() WHERE id=$1`, [sessionId]);
            msg = `האימון ב${p.day} בוטל.`;
        } else if (req.type === 'change') {
            const start = (p.newTime || '').trim();
            if (sessionId) {
                await cx.query(
                    `UPDATE sessions SET start_time=$1, end_time=$2, hall=COALESCE(NULLIF($3,''), hall), status='changed', updated_at=now() WHERE id=$4`,
                    [start || null, start ? addMin(start, 90) : null, p.newLocation || '', sessionId],
                );
            }
            msg = `האימון ב${p.day} שונה ל-${p.newTime}${p.newLocation ? ' ב-' + p.newLocation : ''}.`;
        } else if (req.type === 'move') {
            if (sessionId) await cx.query(`UPDATE sessions SET status='moved', updated_at=now() WHERE id=$1`, [sessionId]);
            const start = (p.newTime || '').trim();
            const nIdx = dayIndex(p.newDay);
            let date = null;
            if (pub && nIdx >= 0) { const d = new Date(pub.week_start + 'T00:00:00'); d.setDate(d.getDate() + nIdx); date = d.toISOString().slice(0, 10); }
            await cx.query(
                `INSERT INTO sessions (publication_id, club_id, team, hall, date, day_of_week, start_time, end_time, type, status, note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'training','changed',$9)`,
                [pub?.id, cid, p.team, p.newLocation || null, date, nIdx >= 0 ? nIdx : null, start || null, start ? addMin(start, 90) : null, `הוזז מ${p.day}`],
            );
            msg = `האימון מ${p.day} הוזז ליום ${p.newDay} ${p.newTime}${p.newLocation ? ' ב-' + p.newLocation : ''}.`;
        }

        await cx.query(`UPDATE change_requests SET status='approved', resolved_at=now() WHERE id=$1`, [id]);
        await cx.query(
            `INSERT INTO audit_log (club_id, actor, action, entity, entity_id, diff) VALUES ($1,'manager','approve','change_request',$2,$3)`,
            [cid, id, JSON.stringify({ type: req.type, proposed: p })],
        );

        // notify the team (best-effort; push delivery handled by notify.broadcast)
        broadcast(slug, { segment: 'team:' + p.team, title: 'עדכון לו"ז — ' + p.team, body: msg }).catch(() => {});
        return { ok: true, message: msg };
    });
}
