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

// Reset the draft to be an exact copy of the current LIVE schedule — a clean "undo" that
// throws away unpublished draft edits (e.g. a games/goalkeeper import the manager tried out)
// and brings back exactly what parents currently see. If there's no live schedule yet, the
// draft is emptied. Does NOT touch the live schedule.
export async function resetDraftFromLive(slug) {
    const draft = await getOrCreateDraft(slug);
    return withTx(async (cx) => {
        const live = await cx.query(
            `SELECT id, week_start::text FROM schedule_publications
             WHERE club_id=$1 AND status='live' ORDER BY week_start DESC LIMIT 1`,
            [draft.clubId],
        );
        await cx.query('DELETE FROM sessions WHERE publication_id=$1', [draft.id]);
        if (!live.rows.length) return { ok: true, draftId: draft.id, sessionCount: 0, fromLive: false };
        await cx.query(`UPDATE schedule_publications SET week_start=$2 WHERE id=$1`, [draft.id, live.rows[0].week_start]);
        await cx.query(
            `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
             SELECT $1, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, 'active', note
             FROM sessions WHERE publication_id=$2`,
            [draft.id, live.rows[0].id],
        );
        const n = (await cx.query(`SELECT count(*)::int n FROM sessions WHERE publication_id=$1`, [draft.id])).rows[0].n;
        return { ok: true, draftId: draft.id, sessionCount: n, fromLive: true };
    });
}

// Append extra sessions (games / goalkeeper trainings) to an existing schedule WITHOUT
// rebuilding it — used by the games/GK importers. target='live' adds straight to the schedule
// parents see now (current week); target='draft' adds to next week's draft. Each session's date
// is derived from the target publication's week + day_of_week when not given. Idempotent per
// (team, day_of_week, note) so re-running the same import doesn't duplicate. Returns the distinct
// teams that were actually updated (for the manager's "notify these teams" push).
export async function appendSessions(slug, target, sessions = []) {
    const clubId = await clubIdOf(slug);
    if (!clubId) throw new Error('Unknown club: ' + slug);
    let pub;
    if (target === 'live') {
        // Several weeks can be live; "add now" means the CURRENT week — prefer it, else the most
        // recent past week (recurring), else the earliest live week.
        const r = await pool.query(
            `SELECT id, week_start::text FROM schedule_publications WHERE club_id=$1 AND status='live' ORDER BY week_start`,
            [clubId],
        );
        if (!r.rows.length) throw new Error('אין לו"ז חי לפרסם אליו — פרסם לו"ז קודם, או טען לשבוע הבא (טיוטה).');
        const cur = israelCurrentWeekSunday();
        const row = r.rows.find((x) => x.week_start === cur) || [...r.rows].reverse().find((x) => x.week_start < cur) || r.rows[0];
        pub = { id: row.id, weekStart: row.week_start };
    } else {
        const d = await getOrCreateDraft(slug);
        pub = { id: d.id, weekStart: d.weekStart };
    }
    return withTx(async (cx) => {
        const dateFor = (s) => {
            if (s.date) return s.date;
            if (pub.weekStart && s.day_of_week !== null && s.day_of_week !== undefined) {
                const d = new Date(pub.weekStart + 'T00:00:00'); d.setDate(d.getDate() + Number(s.day_of_week));
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            }
            return null;
        };
        const affected = new Set();
        let inserted = 0, skipped = 0;
        for (const s of sessions) {
            const team = (s.team || '').trim();
            if (!team || s.day_of_week === null || s.day_of_week === undefined) { skipped++; continue; }
            const note = (s.note || '').trim();
            // Skip an identical line already present (re-run safety).
            const dup = await cx.query(
                `SELECT 1 FROM sessions WHERE publication_id=$1 AND team=$2 AND day_of_week=$3 AND coalesce(note,'')=$4 LIMIT 1`,
                [pub.id, team, s.day_of_week, note],
            );
            if (dup.rows.length) { skipped++; affected.add(team); continue; }
            await cx.query(
                `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
                [pub.id, clubId, team, s.coach || null, s.gender || 'M', s.hall || null,
                 dateFor(s), s.day_of_week, s.start_time || null, s.end_time || null, s.type || 'training', note],
            );
            inserted++; affected.add(team);
        }
        return { ok: true, target, inserted, skipped, affectedTeams: [...affected], weekStart: pub.weekStart };
    });
}

// Seed the draft from an uploaded Excel/CSV (reuses the live-publish parser).
export async function importCsvToDraft(slug, csvText) {
    const { sessions, weekStart } = parseSheetToSessions(csvText);
    // A "permanent" file has day columns but no dates → parser returns no weekStart. Default to the
    // UPCOMING week (today if Sunday, else the coming Sunday) — the same default a from-scratch draft
    // uses — so a schedule prepared late in the week lands on the week about to start, not the one
    // ending. The manager can still pick any week in the preview's date picker before publishing.
    return replaceDraftSessions(slug, sessions, weekStart || upcomingSunday());
}

// Promote the draft → live: archive the current live week, flip draft to live,
// refresh the teams table, then open NEXT week's draft as a copy of what was just
// published (dates shifted +7) so the manager tweaks rather than rebuilds.
// Sunday of the CURRENT week in Israel time (robust to the server's UTC clock near midnight).
function israelCurrentWeekSunday() {
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
    const [Y, M, D] = ymd.split('-').map(Number);
    const d = new Date(Date.UTC(Y, M - 1, D));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export async function publishDraft(slug, publishedBy = 'manager') {
    const draft = await getOrCreateDraft(slug);
    return withTx(async (cx) => {
        let ws = (await cx.query(`SELECT week_start::text FROM schedule_publications WHERE id=$1`, [draft.id])).rows[0].week_start;
        const count = (await cx.query(`SELECT count(*)::int n FROM sessions WHERE publication_id=$1`, [draft.id])).rows[0].n;
        if (!count) throw new Error('הטיוטה ריקה — אין מה לפרסם');
        // Never publish a week that already ended: if the draft is anchored to a past week, roll it
        // (and its session dates, by day-of-week) forward to the current week. A current/future week
        // (e.g. deliberately prepared ahead) is left exactly as chosen.
        const curWeek = israelCurrentWeekSunday();
        if (ws && ws < curWeek) {
            await cx.query(`UPDATE sessions SET date = ($2::date + day_of_week) WHERE publication_id=$1 AND day_of_week IS NOT NULL`, [draft.id, curWeek]);
            await cx.query(`UPDATE schedule_publications SET week_start=$2 WHERE id=$1`, [draft.id, curWeek]);
            ws = curWeek;
        }
        // Keep MULTIPLE weeks live at once (e.g. this week + next week) so publishing next week on
        // Thursday doesn't hide the current week's Fri/Sat games from parents. Archive only the week
        // being republished (same week_start) and any week already in the past; the current and other
        // future weeks stay live. The public board defaults to the current week with a week switcher.
        await cx.query(`UPDATE schedule_publications SET status='archived' WHERE club_id=$1 AND status='live' AND (week_start=$2 OR week_start<$3)`, [draft.clubId, ws, curWeek]);
        await cx.query(`UPDATE schedule_publications SET status='live', published_by=$2, published_at=now() WHERE id=$1`, [draft.id, publishedBy]);
        // Fill each session's coach from the trainers assignment ("ניהול מאמנים") when the schedule
        // was imported without a coach column, so parents see the coach on the published board. Match
        // by normalized team name (strip geresh/quotes, collapse spaces) — trainer team names often
        // omit the geresh ("טרום א" vs "טרום א׳"). Runs BEFORE seedTeamsFromSessions and the next-draft
        // copy below, so teams.coach and the reopened draft inherit the coach too. Only fills EMPTY
        // coaches — a coach already on the session (imported/edited) is never overwritten.
        const normTeam = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
        const trs = await cx.query('SELECT name, teams FROM trainers WHERE club_id=$1', [draft.clubId]);
        const coachByTeam = {};
        trs.rows.forEach((tr) => (tr.teams || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((tm) => {
            const k = normTeam(tm); if (k && !coachByTeam[k]) coachByTeam[k] = tr.name;
        }));
        if (Object.keys(coachByTeam).length) {
            const need = await cx.query(`SELECT DISTINCT team FROM sessions WHERE publication_id=$1 AND coalesce(coach,'')=''`, [draft.id]);
            for (const row of need.rows) {
                const coach = coachByTeam[normTeam(row.team)];
                if (coach) await cx.query(`UPDATE sessions SET coach=$3 WHERE publication_id=$1 AND team=$2 AND coalesce(coach,'')=''`, [draft.id, row.team, coach]);
            }
        }
        await seedTeamsFromSessions(cx, draft.clubId, draft.id);
        await cx.query(
            `INSERT INTO audit_log (club_id, actor, action, entity, entity_id, diff)
             VALUES ($1,$2,'publish','schedule_publication',$3,$4)`,
            [draft.clubId, publishedBy, draft.id, JSON.stringify({ weekStart: ws, sessionCount: count, source: 'draft' })],
        );
        // Re-open a fresh draft as an exact copy of what was just published, for the SAME
        // week. Previously this rolled +7, which made the preview date surprise-jump and made
        // a second publish the same day silently publish a DIFFERENT (next) week. Keeping the
        // same week means re-publishing updates the same week (idempotent). To prepare next
        // week, the manager advances the date in the preview (that re-dates the draft).
        const np = await cx.query(
            `INSERT INTO schedule_publications (club_id, week_start, status, published_by) VALUES ($1,$2,'draft','manager') RETURNING id`,
            [draft.clubId, ws],
        );
        await cx.query(
            `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
             SELECT $1, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, 'active', note
             FROM sessions WHERE publication_id=$2`,
            [np.rows[0].id, draft.id],
        );
        return { ok: true, publicationId: draft.id, weekStart: ws, sessionCount: count };
    });
}
