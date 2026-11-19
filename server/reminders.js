// Pre-training reminder sweep. The native app has no Capacitor bridge on the live-web origin, so
// the old device-local LocalNotifications reminder (src/nativeReminders.js) never schedules there.
// Instead the SERVER pushes "training soon" ~2h before each session to the opt-in channel
// "remind:<team>" (see notify.broadcast / nativePush.matchingTokens). Only devices that turned the
// reminder on subscribe to that channel, so this is independent of general team pushes and is a
// no-op until someone opts in — fully additive.
import { pool } from './db.js';
import { getLiveSchedule } from './publish.js';
import { broadcast } from './notify.js';
import { getSetting, setSetting } from './settings.js';

const LEAD_MIN = 120;              // remind up to 2h before kickoff
const SENT_KEY = 'reminderSent';   // club_settings: capped list of already-notified session keys
const SENT_MAX = 300;

const pad = (n) => String(n).padStart(2, '0');
// "Naive" Israel wall-clock Date: its local fields equal IL wall-clock. Comparing two such Dates
// (ilNow vs a session built the same way) yields the real elapsed time, since both carry the same
// server-tz offset. Avoids pulling in a tz library.
function ilNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })); }
function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Pure: which sessions start within the next LEAD_MIN (given `now` as a naive IL wall-clock Date).
// Rolls a past-week publication forward to the current week, like the board + ICS. Returns
// [{ team, date, start_time, type, hall, key }] — no I/O, so it's unit-testable.
export function selectDue(data, now, leadMin = LEAD_MIN) {
    const sessions = (data && data.sessions) || [];
    const curSunday = new Date(now); curSunday.setHours(0, 0, 0, 0); curSunday.setDate(curSunday.getDate() - curSunday.getDay());
    const rollToCurrent = data?.publication?.week_start && data.publication.week_start < fmt(curSunday);
    const dateForDow = (dow) => { const d = new Date(curSunday); d.setDate(d.getDate() + Number(dow)); return fmt(d); };
    const due = [];
    for (const s of sessions) {
        if (!s.team || !s.start_time) continue;
        if ((s.status || 'active') === 'cancelled') continue;
        const dow = Number.isInteger(s.day_of_week) ? s.day_of_week : (s.date ? new Date(`${s.date}T00:00:00`).getDay() : null);
        const sdate = rollToCurrent ? (dow === null ? s.date : dateForDow(dow)) : s.date;
        if (!sdate) continue;
        const [Y, M, D] = sdate.split('-').map(Number);
        const [hh, mm] = s.start_time.split(':').map(Number);
        if (!Y || Number.isNaN(hh)) continue;
        const sessionWall = new Date(Y, M - 1, D, hh, mm, 0); // naive IL wall-clock, like `now`
        const minsUntil = (sessionWall - now) / 60000;
        if (minsUntil <= 0 || minsUntil > leadMin) continue; // past, or still more than the lead away
        due.push({ team: s.team, date: sdate, start_time: s.start_time, type: s.type, hall: s.hall || '', key: `${s.team}|${sdate}|${s.start_time}` });
    }
    return due;
}

// One club: find sessions starting within the next LEAD_MIN and push once each to remind:<team>.
async function sweepClub(slug) {
    const data = await getLiveSchedule(slug).catch(() => null);
    if (!data || !(data.sessions || []).length) return { slug, sent: 0 };

    const now = ilNow();
    const due = selectDue(data, now);
    if (!due.length) return { slug, sent: 0 };

    const sentArr = (await getSetting(slug, SENT_KEY).catch(() => null)) || [];
    const sent = new Set(Array.isArray(sentArr) ? sentArr : []);
    const added = [];
    let delivered = 0;

    for (const d of due) {
        if (sent.has(d.key)) continue;
        const title = d.type === 'match' ? '⚽ משחק מתקרב' : '🏃 אימון מתקרב';
        const body = `${d.team} · היום ${d.start_time}${d.hall ? ' · ' + d.hall : ''}`;
        try {
            await broadcast(slug, { segment: 'remind:' + d.team, title, body, url: `/${slug}`, tag: 'remind' });
            delivered++;
        } catch { /* delivery failed — don't mark sent, retry next sweep */ continue; }
        sent.add(d.key); added.push(d.key);
    }

    if (added.length) {
        // Keep recent keys only: prune anything whose date is older than yesterday, then cap.
        const cutoff = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const kept = [...sent].filter((k) => (k.split('|')[1] || '') >= cutoff).slice(-SENT_MAX);
        await setSetting(slug, SENT_KEY, kept).catch(() => {});
    }
    return { slug, sent: delivered };
}

// Sweep every club. Safe to call on an interval; each club is isolated.
export async function sweepReminders() {
    let clubs = [];
    try { clubs = (await pool.query('SELECT slug FROM clubs')).rows.map((r) => r.slug); } catch { return { clubs: 0, sent: 0 }; }
    let total = 0;
    for (const slug of clubs) {
        try { const r = await sweepClub(slug); total += r.sent; } catch { /* isolate one club's failure */ }
    }
    return { clubs: clubs.length, sent: total };
}

// Start the periodic sweep (no-op-safe). Returns the timer so a caller could clear it.
export function startReminderSweeps(everyMs = 15 * 60 * 1000) {
    sweepReminders().catch(() => {}); // run once at boot
    const t = setInterval(() => { sweepReminders().catch(() => {}); }, everyMs);
    if (t.unref) t.unref();
    return t;
}
