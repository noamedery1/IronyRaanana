// Attendance / RSVP: a parent marks their player in ('in') or out ('out') for one training or
// match occurrence (team + date + start_time). The coach sees who's coming, who isn't, and who
// hasn't replied (roster minus responders). Additive, opt-in per coach for the drop-out push.
import { pool } from './db.js';
import { clubId } from './people.js';
import { broadcast } from './notify.js';

const VALID = new Set(['in', 'out']);

// Israel wall-clock now (DST-safe) as {date:'YYYY-MM-DD', time:'HH:MM'} — the kickoff cutoff is local.
function ilNow() {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };

// A drop-out is "last-minute" (worth pushing the coach) when the occurrence is TODAY and its start is
// still ahead but within `windowH` hours. Pure + exported for the self-check. Conservative: only today,
// only before kickoff — never a far-future or already-started session.
export function isLastMinute(date, startTime, nowIl, windowH = 3) {
    if (!date || date !== nowIl.date) return false;
    const s = toMin(startTime); const n = toMin(nowIl.time);
    if (s == null || n == null) return false;
    return s >= n && s - n <= windowH * 60;
}

// Parent marks their player in/out. Identity comes from the member token (never trust a client-sent
// name/team). Upsert one row per (member, occurrence). Fires a coach push only on a last-minute 'out'
// and only if that team's coach opted in.
export async function setRsvp(slug, token, { team: reqTeam, date, start_time = '', status }) {
    const tok = (token || '').trim();
    if (!tok) throw new Error('חסר מזהה משתמש');
    if (!VALID.has(status)) throw new Error('סטטוס לא תקין');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('תאריך לא תקין');
    const cid = await clubId(slug);
    // One parent can hold several child registrations. Identify the child by the token AND the team
    // being marked (a shared device token across kids, or distinct tokens — either way (token,team)
    // picks the right child), so marking one team never marks the others.
    const rows = (await pool.query(`SELECT name, team FROM app_users WHERE club_id=$1 AND token=$2 AND role='member'`, [cid, tok])).rows;
    if (!rows.length) throw new Error('משתמש לא נמצא');
    const nrm0 = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
    const match = reqTeam ? rows.find((r) => nrm0(r.team) === nrm0(reqTeam)) : (rows.length === 1 ? rows[0] : null);
    if (!match) throw new Error('הקבוצה לא משויכת למשתמש');
    const { name, team } = match;
    if (!team) throw new Error('למשתמש אין קבוצה');
    await pool.query(
        `INSERT INTO attendance (club_id, member_token, member_name, team, date, start_time, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (club_id, member_token, team, date, start_time)
         DO UPDATE SET status=excluded.status, member_name=excluded.member_name, updated_at=now()`,
        [cid, tok, name, team, date, start_time, status],
    );
    if (status === 'out' && isLastMinute(date, start_time, ilNow())) {
        pushCoachDropout(slug, cid, team, name, date, start_time).catch((e) => console.error('[attendance] coach push failed', e.message));
    }
    return { ok: true, team, name, date, start_time, status };
}

// Notify the team's opted-in coach that a player just dropped out close to kickoff.
async function pushCoachDropout(slug, cid, team, playerName, date, start_time) {
    const nrm = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
    const key = nrm(team);
    const trs = await pool.query('SELECT name, teams, notify_rsvp FROM trainers WHERE club_id=$1 AND notify_rsvp=true', [cid]);
    const coach = trs.rows.find((t) => (t.teams || '').split(/[,;\n]/).some((x) => nrm(x) === key));
    if (!coach) return;
    const heDate = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
    const when = heDate ? `${heDate[2]}/${heDate[1]}${start_time ? ' ' + start_time : ''}` : (start_time || '');
    broadcast(slug, {
        segment: '__TRAINER__:' + coach.name,
        title: `🚫 ביטול הגעה — ${team}`,
        body: `${playerName} לא מגיע ל${start_time ? 'אימון' : 'מפגש'} (${when})`,
    }).catch(() => {});
}

// A member's own saved RSVPs (by their token), so the board can restore the marks after a reload.
export async function getMemberRsvp(slug, token, { from } = {}) {
    const tok = (token || '').trim();
    if (!tok) return { responses: [] };
    const cid = await clubId(slug);
    const since = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '0000-00-00';
    const r = await pool.query(
        `SELECT team, date, start_time, status FROM attendance WHERE club_id=$1 AND member_token=$2 AND date >= $3`,
        [cid, tok, since]);
    return { responses: r.rows };
}

// Coach view: every response for one of the coach's teams from `from` onward, plus the team roster
// (names) so the UI can show "didn't reply". Trainer identity via token; a coach only reads a team
// they coach.
export async function getTeamRsvp(slug, trainerToken, { team, from }) {
    const tok = (trainerToken || '').trim();
    if (!tok) throw new Error('חסר מזהה מאמן');
    if (!team) throw new Error('חסרה קבוצה');
    const cid = await clubId(slug);
    const tr = await pool.query('SELECT teams FROM trainers WHERE club_id=$1 AND token=$2 LIMIT 1', [cid, tok]);
    if (!tr.rows.length) throw new Error('מאמן לא נמצא');
    const nrm = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
    const coaches = (tr.rows[0].teams || '').split(/[,;\n]/).map(nrm);
    if (!coaches.includes(nrm(team))) throw new Error('הקבוצה לא משויכת למאמן');
    const since = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '0000-00-00';
    const resp = await pool.query(
        `SELECT member_name AS name, date, start_time, status FROM attendance
         WHERE club_id=$1 AND team=$2 AND date >= $3 ORDER BY date, start_time`,
        [cid, team, since]);
    const roster = await pool.query(
        `SELECT DISTINCT name FROM app_users WHERE club_id=$1 AND role='member' AND team=$2 AND name <> '' ORDER BY name`,
        [cid, team]);
    return { team, roster: roster.rows.map((r) => r.name), responses: resp.rows };
}

// Coach report: per-player attendance over a period for a team the coach coaches. "Occurrences" =
// distinct (date,start_time) that anyone responded to in the range (we don't keep full session
// history), so percentages are over sessions the team actually used the feature for.
export async function getAttendanceReport(slug, trainerToken, { team, from, to }) {
    const tok = (trainerToken || '').trim();
    if (!tok || !team) throw new Error('חסרים פרטים');
    const cid = await clubId(slug);
    const tr = await pool.query('SELECT teams FROM trainers WHERE club_id=$1 AND token=$2 LIMIT 1', [cid, tok]);
    if (!tr.rows.length) throw new Error('מאמן לא נמצא');
    const nrm0 = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
    if (!(tr.rows[0].teams || '').split(/[,;\n]/).map(nrm0).includes(nrm0(team))) throw new Error('הקבוצה לא משויכת למאמן');
    const lo = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : '0000-00-00';
    const hi = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : '9999-12-31';
    const rows = (await pool.query(
        `SELECT member_name AS name, date, start_time, status FROM attendance WHERE club_id=$1 AND team=$2 AND date BETWEEN $3 AND $4`,
        [cid, team, lo, hi])).rows;
    const occ = new Set(rows.map((r) => `${r.date}|${r.start_time || ''}`)).size;
    const roster = (await pool.query(`SELECT DISTINCT name FROM app_users WHERE club_id=$1 AND role='member' AND team=$2 AND name <> ''`, [cid, team])).rows.map((r) => r.name);
    const agg = {};
    roster.forEach((n) => { agg[n] = { name: n, in: 0, out: 0 }; });
    rows.forEach((r) => { const a = agg[r.name] || (agg[r.name] = { name: r.name, in: 0, out: 0 }); if (r.status === 'in') a.in++; else if (r.status === 'out') a.out++; });
    const players = Object.values(agg).sort((a, b) => b.in - a.in || a.name.localeCompare(b.name, 'he'));
    return { team, from: lo, to: hi, occurrences: occ, players };
}

// Coach toggles their own drop-out push preference. Identity via token.
export async function setCoachNotify(slug, trainerToken, on) {
    const cid = await clubId(slug);
    const r = await pool.query('UPDATE trainers SET notify_rsvp=$3 WHERE club_id=$1 AND token=$2 RETURNING notify_rsvp', [cid, (trainerToken || '').trim(), !!on]);
    if (!r.rowCount) throw new Error('מאמן לא נמצא');
    return { ok: true, notify_rsvp: r.rows[0].notify_rsvp };
}
