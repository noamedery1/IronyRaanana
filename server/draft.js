// The DRAFT schedule — the "next week" the manager builds, stored in the DB as a
// schedule_publications row with status='draft' (one per club). Separate from the
// LIVE schedule (what parents + the trainer's main tab see). Publishing promotes
// the draft to live. Excel import seeds the draft.
import { pool, withTx } from './db.js';
import { parseSheetToSessions } from './publish.js';
import { seedTeamsFromSessions } from './people.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// The coming Sunday (today if it's Sunday) — the week the manager is preparing.
const upcomingSunday = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return fmtDate(d); };

async function clubIdOf(slug) {
    const r = await pool.query('SELECT id FROM clubs WHERE slug=$1', [slug]);
    return r.rows[0]?.id || null;
}

// Return the club's open draft publication, creating an empty one if none exists.
export async function getOrCreateDraft(slug, weekStart) {
    const clubId = await clubIdOf(slug);
    if (!clubId) throw new Error('Unknown club: ' + slug);
    const found = await pool.query(
        `SELECT id, week_start::text FROM schedule_publications WHERE club_id=$1 AND status='draft' LIMIT 1`,
        [clubId],
    );
    if (found.rows.length) return { id: found.rows[0].id, clubId, weekStart: found.rows[0].week_start };
    const ws = weekStart || upcomingSunday();
    const ins = await pool.query(
        `INSERT INTO schedule_publications (club_id, week_start, status, published_by)
         VALUES ($1,$2,'draft','manager') RETURNING id, week_start::text`,
        [clubId, ws],
    );
    return { id: ins.rows[0].id, clubId, weekStart: ins.rows[0].week_start };
}

const SESSION_COLS = `team, coach, gender, hall, date::text,
    to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time,
    type, status, day_of_week, note`;

// Read-only view of the draft (next week) — does NOT create one if missing.
// Used by the trainer portal's "propose / enter schedule" tab.
export async function getDraftView(slug) {
    const clubId = await clubIdOf(slug);
    if (!clubId) return { week_start: null, sessions: [] };
    const p = await pool.query(`SELECT id, week_start::text FROM schedule_publications WHERE club_id=$1 AND status='draft' LIMIT 1`, [clubId]);
    if (!p.rows.length) return { week_start: null, sessions: [] };
    const s = await pool.query(`SELECT ${SESSION_COLS} FROM sessions WHERE publication_id=$1 ORDER BY date, start_time, team`, [p.rows[0].id]);
    return { week_start: p.rows[0].week_start, sessions: s.rows };
}

// The draft schedule (publication meta + its sessions).
export async function getDraft(slug) {
    const draft = await getOrCreateDraft(slug);
    const s = await pool.query(
        `SELECT ${SESSION_COLS} FROM sessions WHERE publication_id=$1 ORDER BY date, start_time, team`,
        [draft.id],
    );
    return { publication: { id: draft.id, week_start: draft.weekStart, status: 'draft' }, sessions: s.rows };
}

// Replace ALL draft sessions with the given set (the manager's preview "save draft").
export async function replaceDraftSessions(slug, sessions = [], weekStart) {
    const draft = await getOrCreateDraft(slug, weekStart);
    return withTx(async (cx) => {
        if (weekStart) await cx.query(`UPDATE schedule_publications SET week_start=$2 WHERE id=$1`, [draft.id, weekStart]);
        // the authoritative week for date derivation (passed-in, else the draft's own)
        const ws = weekStart || (await cx.query(`SELECT week_start::text FROM schedule_publications WHERE id=$1`, [draft.id])).rows[0].week_start;
        const dateFor = (s) => {
            if (s.date) return s.date;
            if (ws && s.day_of_week !== null && s.day_of_week !== undefined) {
                const d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate() + Number(s.day_of_week));
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            }
            return null;
        };
        await cx.query('DELETE FROM sessions WHERE publication_id=$1', [draft.id]);
        for (const s of sessions) {
            await cx.query(
                `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [draft.id, draft.clubId, s.team, s.coach || null, s.gender || 'M', s.hall || null,
                 dateFor(s), s.day_of_week ?? null, s.start_time || null, s.end_time || null,
                 s.type || 'training', s.status || 'active', s.note || null],
            );
        }
        return { ok: true, draftId: draft.id, sessionCount: sessions.length };
    });
}

// Seed the draft from an uploaded Excel/CSV (reuses the live-publish parser).
export async function importCsvToDraft(slug, csvText) {
    const { sessions, weekStart } = parseSheetToSessions(csvText);
    return replaceDraftSessions(slug, sessions, weekStart || undefined);
}

// Promote the draft → live: archive the current live week, flip draft to live,
// refresh the teams table, then open NEXT week's draft as a copy of what was just
// published (dates shifted +7) so the manager tweaks rather than rebuilds.
export async function publishDraft(slug, publishedBy = 'manager') {
    const draft = await getOrCreateDraft(slug);
    return withTx(async (cx) => {
        const ws = (await cx.query(`SELECT week_start::text FROM schedule_publications WHERE id=$1`, [draft.id])).rows[0].week_start;
        const count = (await cx.query(`SELECT count(*)::int n FROM sessions WHERE publication_id=$1`, [draft.id])).rows[0].n;
        if (!count) throw new Error('הטיוטה ריקה — אין מה לפרסם');
        await cx.query(`UPDATE schedule_publications SET status='archived' WHERE club_id=$1 AND week_start=$2 AND status='live'`, [draft.clubId, ws]);
        await cx.query(`UPDATE schedule_publications SET status='live', published_by=$2, published_at=now() WHERE id=$1`, [draft.id, publishedBy]);
        await seedTeamsFromSessions(cx, draft.clubId, draft.id);
        await cx.query(
            `INSERT INTO audit_log (club_id, actor, action, entity, entity_id, diff)
             VALUES ($1,$2,'publish','schedule_publication',$3,$4)`,
            [draft.clubId, publishedBy, draft.id, JSON.stringify({ weekStart: ws, sessionCount: count, source: 'draft' })],
        );
        // open next week's draft as a copy of the just-published week (dates +7).
        const nd = new Date(ws + 'T00:00:00'); nd.setDate(nd.getDate() + 7);
        const nextWs = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`;
        const np = await cx.query(
            `INSERT INTO schedule_publications (club_id, week_start, status, published_by) VALUES ($1,$2,'draft','manager') RETURNING id`,
            [draft.clubId, nextWs],
        );
        await cx.query(
            `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
             SELECT $1, club_id, team, coach, gender, hall, (date + INTERVAL '7 days')::date, day_of_week, start_time, end_time, type, 'active', note
             FROM sessions WHERE publication_id=$2`,
            [np.rows[0].id, draft.id],
        );
        return { ok: true, publicationId: draft.id, weekStart: ws, sessionCount: count };
    });
}
