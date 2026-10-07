// Club landing-page registrations ("הרשמה לקבוצה"). A parent fills the public form,
// the row is stored here and the club secretary is emailed so they can call back.
// Additive only: own table, created lazily (deploys don't run migrations — see 0015).
import { pool } from './db.js';
import { clubId } from './people.js';
import { getClub } from './clubsStore.js';
import { getSetting } from './settings.js';
import { sendEmail } from './mailer.js';

let _ready = null;
function ensureTable() {
    if (!_ready) {
        _ready = pool.query(`
            CREATE TABLE IF NOT EXISTS club_signups (
                id          bigserial PRIMARY KEY,
                club_id     uuid NOT NULL,
                team        text,
                child_name  text NOT NULL,
                birth_year  text,
                parent_name text NOT NULL,
                phone       text NOT NULL,
                email       text,
                notes       text,
                consent_at  timestamptz NOT NULL,
                marketing   boolean NOT NULL DEFAULT false,
                status      text NOT NULL DEFAULT 'new',
                created_at  timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS club_signups_club_idx ON club_signups (club_id, created_at DESC);
        `).catch((e) => { _ready = null; throw e; });
    }
    return _ready;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Tiny in-memory throttle per IP (public endpoint).
const hits = new Map();
function throttled(ip) {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    arr.push(now);
    hits.set(ip, arr);
    return arr.length > 5;
}

export async function createSignup(slug, body, ip) {
    if (body.website) return { ok: true }; // honeypot: bots fill hidden fields
    if (throttled(ip || '?')) throw new Error('יותר מדי בקשות, נסו שוב מאוחר יותר');
    const row = {
        team: clip(body.team, 80),
        child_name: clip(body.childName, 80),
        birth_year: clip(body.birthYear, 8),
        parent_name: clip(body.parentName, 80),
        phone: clip(body.phone, 20).replace(/[^\d+]/g, ''),
        email: clip(body.email, 120),
        notes: clip(body.notes, 600),
        marketing: !!body.marketing,
    };
    if (!row.child_name || !row.parent_name) throw new Error('חסר שם');
    if (!/^(\+972|0)5\d{8}$/.test(row.phone) && !/^(\+972|0)\d{8,9}$/.test(row.phone)) throw new Error('מספר טלפון לא תקין');
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) throw new Error('אימייל לא תקין');
    if (!body.consent) throw new Error('יש לאשר את מדיניות הפרטיות');

    await ensureTable();
    const cid = await clubId(slug);
    const r = await pool.query(
        `INSERT INTO club_signups (club_id, team, child_name, birth_year, parent_name, phone, email, notes, consent_at, marketing)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) RETURNING id`,
        [cid, row.team, row.child_name, row.birth_year, row.parent_name, row.phone, row.email, row.notes, row.marketing],
    );

    // Notify the secretary: per-club setting `signupEmail` (string or array), else the club managers.
    try {
        const club = await getClub(slug);
        const setting = await getSetting(slug, 'signupEmail').catch(() => null);
        const to = (Array.isArray(setting) ? setting : setting ? [setting] : null) || club?.managerEmails || [];
        if (to.length) {
            const lines = [
                ['קבוצה', row.team || 'לא נבחרה'], ['שם הילד/ה', row.child_name], ['שנת לידה', row.birth_year],
                ['הורה', row.parent_name], ['טלפון', row.phone], ['אימייל', row.email], ['הערות', row.notes],
            ].filter(([, v]) => v);
            const wa = 'https://wa.me/' + row.phone.replace(/^0/, '972').replace(/^\+/, '');
            await sendEmail({
                to,
                subject: `הרשמה חדשה — ${row.child_name} (${row.team || 'ללא קבוצה'})`,
                html: `<div dir="rtl" style="font-family:Arial,sans-serif">
                    <h2>הרשמה חדשה מדף המועדון — ${esc(club?.name || slug)}</h2>
                    <table cellpadding="6">${lines.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>
                    <p><a href="tel:${esc(row.phone)}">📞 התקשרו</a> · <a href="${esc(wa)}">💬 וואטסאפ</a></p>
                    <p style="color:#888">מס' פנייה ${r.rows[0].id}</p></div>`,
            });
        }
    } catch (e) { console.warn('[signups] notify failed:', e.message); }

    return { ok: true, id: r.rows[0].id };
}

export async function listSignups(slug) {
    await ensureTable();
    const cid = await clubId(slug);
    const r = await pool.query('SELECT * FROM club_signups WHERE club_id=$1 ORDER BY created_at DESC LIMIT 500', [cid]);
    return r.rows;
}

export async function setSignupStatus(slug, id, status) {
    if (!['new', 'contacted', 'joined', 'closed'].includes(status)) throw new Error('bad status');
    await ensureTable();
    const cid = await clubId(slug);
    await pool.query('UPDATE club_signups SET status=$3 WHERE club_id=$1 AND id=$2', [cid, id, status]);
    return { ok: true };
}

// Privacy-law right of deletion: secretary removes a row on request.
export async function deleteSignup(slug, id) {
    await ensureTable();
    const cid = await clubId(slug);
    await pool.query('DELETE FROM club_signups WHERE club_id=$1 AND id=$2', [cid, id]);
    return { ok: true };
}
