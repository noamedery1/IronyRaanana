// Phase 1: "publish schedule" — pull a club's Google Sheet (the manager's draft),
// parse it into normalized session rows, and snapshot it into the DB as the live
// schedule for a dated week. Reuses the existing CSV parsing from scheduleCore.
import Papa from 'papaparse';
import { pool, withTx } from './db.js';
import { parseCellContent, parseHeaderDate, parseTime } from './scheduleCore.js';
import { getClub } from './clubsStore.js';
import { seedTeamsFromSessions } from './people.js';

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sundayOf = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };

function classifyType(team, isMatch) {
    if (isMatch) return 'match';
    const t = team || '';
    if (t.includes('השכרה')) return 'rental';
    if (t.includes('בית ספר')) return 'school';
    if (t.includes('טקס')) return 'event';
    return 'training';
}
const statusOf = (s) => (s === 'cancelled' ? 'cancelled' : s === 'changed' ? 'changed' : 'active');

// CSV text -> { sessions[], weekStart }. Pure (no DB) so it's easy to test.
export function parseSheetToSessions(csvText) {
    const rows = Papa.parse(csvText, { header: false }).data;
    let h = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].includes('קבוצות')) { h = i; break; }
    }
    if (h === -1) throw new Error('Header row containing "קבוצות" not found');

    const header = rows[h];
    const dataRows = rows.slice(h + 1);
    const coachIdx = header.findIndex((x) => x && (x.includes('מאמן') || /coach|trainer/i.test(x)));
    const typeIdx = header.findIndex((x) => x && (x.toLowerCase() === 'type' || x.includes('סוג') || x.includes('מגדר')));
    let dayStart = header.findIndex((x) => x && x.includes('ראשון'));
    if (dayStart === -1) dayStart = coachIdx !== -1 ? coachIdx + 1 : 1;

    const sessions = [];
    const dates = [];
    for (const row of dataRows) {
        const name = (row[0] || '').trim();
        if (!name || /באנר|banner/i.test(name)) continue;
        const coach = coachIdx !== -1 ? (row[coachIdx] || '').trim() : '';
        const rawType = typeIdx !== -1 ? (row[typeIdx] || '').trim() : '';
        const gender = /\bw\b|women|female|נשים|בנות|נערות|ילדות/i.test(rawType) ? 'W' : 'M';

        for (let i = 0; i < 7; i++) {
            const cell = row[dayStart + i];
            if (!cell || !cell.trim() || cell.toLowerCase().includes('xxx')) continue;
            const date = parseHeaderDate(header[dayStart + i] || '');
            cell.split('\n').forEach((line) => {
                if (!line.trim()) return;
                const { time, location, isMatch, status } = parseCellContent(line);
                if (!location && !time) return;
                const parts = (time || '').split('-');
                const st = parseTime(parts[0]);
                const startMin = st.h * 60 + st.m;
                let endMin;
                if (parts[1]) { const e = parseTime(parts[1]); endMin = e.h * 60 + e.m; }
                else { endMin = startMin + 90; } // default 90-min session
                const hhmm = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
                sessions.push({
                    team: name, coach, gender,
                    hall: location || null,
                    date: date ? fmtDate(date) : null,
                    day_of_week: i,
                    start_time: time ? hhmm(startMin) : null,
                    end_time: time ? hhmm(endMin) : null,
                    type: classifyType(name, isMatch),
                    status: statusOf(status),
                    note: line.trim(),
                });
                if (date) dates.push(date);
            });
        }
    }

    let weekStart = null;
    if (dates.length) weekStart = fmtDate(sundayOf(new Date(Math.min(...dates.map((d) => d.getTime())))));
    return { sessions, weekStart };
}

// Pull the club's sheet and snapshot it as a new live publication for its week.
export async function publishClub(slug, { weekStart: forced, publishedBy = 'admin' } = {}) {
    const club = getClub(slug);
    if (!club) throw new Error('Unknown club: ' + slug);
    // The manager edits the dashboard sheet ("his Excel"); publish reads that (publishUrl),
    // falling back to dataUrl for clubs that edit the public sheet directly.
    const sourceUrl = club.publishUrl || club.dataUrl;
    if (!sourceUrl) throw new Error('Club has no publish source');

    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error('Failed to fetch sheet CSV: ' + res.status);
    const csv = await res.text();

    const { sessions, weekStart: detected } = parseSheetToSessions(csv);
    const weekStart = forced || detected;
    if (!weekStart) throw new Error('Could not determine week_start (no dated day headers); pass weekStart explicitly');

    return withTx(async (cx) => {
        const c = await cx.query(
            `INSERT INTO clubs (slug, name, sport, data_url) VALUES ($1,$2,$3,$4)
             ON CONFLICT (slug) DO UPDATE SET name=excluded.name, sport=excluded.sport, data_url=excluded.data_url
             RETURNING id`,
            [club.slug, club.name, club.sport || null, club.dataUrl],
        );
        const clubId = c.rows[0].id;

        await cx.query(
            `UPDATE schedule_publications SET status='archived' WHERE club_id=$1 AND week_start=$2 AND status='live'`,
            [clubId, weekStart],
        );
        const p = await cx.query(
            `INSERT INTO schedule_publications (club_id, week_start, status, source_url, published_by)
             VALUES ($1,$2,'live',$3,$4) RETURNING id`,
            [clubId, weekStart, sourceUrl, publishedBy],
        );
        const pubId = p.rows[0].id;

        for (const s of sessions) {
            await cx.query(
                `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [pubId, clubId, s.team, s.coach || null, s.gender, s.hall, s.date, s.day_of_week, s.start_time, s.end_time, s.type, s.status, s.note],
            );
        }

        await seedTeamsFromSessions(cx, clubId, pubId); // keep the teams table in sync

        await cx.query(
            `INSERT INTO audit_log (club_id, actor, action, entity, entity_id, diff)
             VALUES ($1,$2,'publish','schedule_publication',$3,$4)`,
            [clubId, publishedBy, pubId, JSON.stringify({ weekStart, sessionCount: sessions.length })],
        );

        const conflicts = await cx.query(
            `SELECT hall, date::text, to_char(start_time,'HH24:MI') AS start_time,
                    count(*)::int AS count, array_agg(team) AS teams
             FROM sessions WHERE publication_id=$1 AND hall IS NOT NULL AND date IS NOT NULL
             GROUP BY hall, date, start_time HAVING count(*) > 1`,
            [pubId],
        );

        return { clubId, publicationId: pubId, weekStart, sessionCount: sessions.length, conflicts: conflicts.rows };
    });
}

// Live schedule for the public site (latest live publication, or a specific week).
export async function getLiveSchedule(slug, week) {
    const club = await pool.query('SELECT id FROM clubs WHERE slug=$1', [slug]);
    if (!club.rows.length) return null;
    const clubId = club.rows[0].id;

    const cols = `id, club_id, week_start::text, status, source_url, published_by, published_at`;
    const pub = week
        ? await pool.query(`SELECT ${cols} FROM schedule_publications WHERE club_id=$1 AND week_start=$2 AND status='live'`, [clubId, week])
        : await pool.query(`SELECT ${cols} FROM schedule_publications WHERE club_id=$1 AND status='live' ORDER BY week_start DESC LIMIT 1`, [clubId]);
    if (!pub.rows.length) return { publication: null, sessions: [] };

    const p = pub.rows[0];
    const s = await pool.query(
        `SELECT team, coach, gender, hall, date::text,
                to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time,
                type, status, note
         FROM sessions WHERE publication_id=$1 ORDER BY date, start_time`,
        [p.id],
    );
    return { publication: p, sessions: s.rows };
}

// Publication history (for the manager's "recent publications" panel / restore).
export async function listPublications(slug) {
    const r = await pool.query(
        `SELECT p.id, p.week_start::text, p.status, p.published_at, p.published_by,
                (SELECT count(*)::int FROM sessions s WHERE s.publication_id=p.id) AS sessions
         FROM schedule_publications p JOIN clubs c ON c.id=p.club_id
         WHERE c.slug=$1 ORDER BY p.published_at DESC`,
        [slug],
    );
    return r.rows;
}
