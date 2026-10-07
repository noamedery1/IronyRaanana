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

const PUBLIC_BASE = process.env.APP_PUBLIC_URL || 'https://squadio.techbynoam.com';
const abs = (u) => (!u ? '' : /^https?:/.test(u) ? u : PUBLIC_BASE + (u.startsWith('/') ? '' : '/') + u);
const fmtPhone = (p) => { const d = String(p).replace(/^\+972/, '0'); return /^05\d{8}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d; };

// Email-safe HTML (tables + inline styles only; Gmail/Outlook strip <style> and flex/grid).
export function signupEmailHtml({ club, slug, row, id, at }) {
    const accent = /^#[0-9a-f]{6}$/i.test(club?.themeColor || '') ? club.themeColor : '#d90b18';
    const name = esc(club?.name || slug);
    const logo = abs(club?.icon192 || club?.logo || `/api/${slug}/icon/192`);
    const intl = row.phone.replace(/^0/, '972').replace(/^\+/, '');
    const waText = `היי ${row.parent_name}, כאן מ${club?.name || 'המועדון'} — לגבי ההרשמה של ${row.child_name}${row.team ? ` ל${row.team}` : ''} ⚽`;
    const wa = `https://wa.me/${intl}?text=${encodeURIComponent(waText)}`;
    const when = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }).format(at);
    const field = (k, v) => v ? `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#777;font-size:14px;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #eee;color:#111;font-size:16px;font-weight:bold">${v}</td></tr>` : '';
    const btn = (href, label, bg) => `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 22px;border-radius:12px;margin:4px">${label}</a>`;
    return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2efe9;font-family:Arial,Helvetica,sans-serif" dir="rtl">
<div style="display:none;max-height:0;overflow:hidden">${esc(row.parent_name)} השאיר/ה פרטים — ${esc(row.child_name)}, ${esc(row.team || 'ללא קבוצה')}. ${esc(fmtPhone(row.phone))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.06)">
  <tr><td style="background:#0d0d0f;padding:22px 24px;border-bottom:5px solid ${accent}" dir="rtl">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="64" style="vertical-align:middle"><img src="${esc(logo)}" width="56" height="56" alt="" style="display:block;border-radius:50%;background:#fff;border:2px solid #fff"></td>
      <td style="vertical-align:middle;padding-right:14px;color:#fff;text-align:right">
        <div style="font-size:12px;letter-spacing:2px;color:${accent};font-weight:bold">הרשמה חדשה מהאתר</div>
        <div style="font-size:22px;font-weight:bold;margin-top:2px">${name}</div>
      </td></tr></table>
  </td></tr>
  <tr><td style="padding:24px 24px 6px;text-align:right" dir="rtl">
    <div style="font-size:15px;color:#555">${esc(row.parent_name)} השאיר/ה פרטים להרשמה. כדאי לחזור אליו/ה בהקדם 👇</div>
    <div style="margin-top:14px;background:#faf7f2;border-radius:14px;padding:16px 18px;border-right:4px solid ${accent}">
      <div style="font-size:13px;color:#777">קבוצה מבוקשת</div>
      <div style="font-size:24px;font-weight:bold;color:#111;margin-top:2px">${esc(row.team || 'לא נבחרה — לעזור לבחור')}</div>
    </div>
  </td></tr>
  <tr><td style="padding:8px 24px 0" dir="rtl">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="text-align:right">
      ${field('שם הילד/ה', esc(row.child_name))}
      ${field('שנת לידה', esc(row.birth_year))}
      ${field('הורה', esc(row.parent_name))}
      ${field('טלפון', `<a href="tel:${esc(row.phone)}" style="color:#111;text-decoration:none" dir="ltr">${esc(fmtPhone(row.phone))}</a>`)}
      ${field('אימייל', row.email ? `<a href="mailto:${esc(row.email)}" style="color:#111">${esc(row.email)}</a>` : '')}
      ${field('הערות', esc(row.notes))}
      ${field('דיוור', row.marketing ? 'אישר/ה קבלת עדכונים' : '')}
    </table>
  </td></tr>
  <tr><td align="center" style="padding:22px 16px 8px">
    ${btn(wa, '💬 וואטסאפ', '#1faa59')}${btn('tel:' + row.phone, '📞 התקשרו', accent)}
  </td></tr>
  <tr><td style="padding:12px 24px 22px;text-align:center;color:#999;font-size:12px" dir="rtl">פנייה מס' ${esc(id)} · ${esc(when)}</td></tr>
  <tr><td style="background:#faf7f2;padding:14px 24px;text-align:center;color:#999;font-size:11px;line-height:1.6" dir="rtl">
    המידע נמסר בהסכמת ההורה לצורך יצירת קשר והרשמה בלבד — אין להעבירו לגורם אחר.<br>נשלח אוטומטית ע״י <a href="https://squadio.techbynoam.com/sales-landing" style="color:#999">Squadio</a>
  </td></tr>
</table></td></tr></table></body></html>`;
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
            const sent = await sendEmail({
                to,
                fromName: `${club?.name || slug} · Squadio`,
                subject: `הרשמה חדשה — ${row.child_name} (${row.team || 'ללא קבוצה'})`,
                html: signupEmailHtml({ club, slug, row, id: r.rows[0].id, at: new Date() }),
            });
            if (!sent.ok || sent.dev) console.warn('[signups] email not delivered:', sent.reason || 'dev mode (no RESEND_API_KEY)');
        } else {
            console.warn('[signups] no recipient configured for', slug);
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

// Counts only (no personal data) — surfaced in /api/health to confirm the form reaches the DB.
export async function signupDiag() {
    await ensureTable();
    const r = await pool.query('SELECT count(*)::int AS total, max(created_at) AS last_at FROM club_signups');
    return r.rows[0];
}
