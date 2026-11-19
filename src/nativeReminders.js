// Native local reminders (F3): inside the native app, schedule a local notification before each
// upcoming session of the teams the parent turned reminders on for (account settings). On the web
// there's no LocalNotifications plugin, so this is a safe no-op. Idempotent: it cancels what it
// scheduled and reschedules from the current schedule each run, so changes stay in sync.
import { getReminderPrefs, getNickname } from './userIdentity.js';

const LN = () => (typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications) || null;
const nrm = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
// Stable positive 31-bit id from a string (Capacitor notification ids are Java ints).
const hashId = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2147483647 || 1; };

const LEAD_MS = 2 * 60 * 60 * 1000; // remind 2h before kickoff

// Schedule reminders for the member's reminder-enabled teams. Safe to call often.
export async function syncReminders(clubSlug, memberships = []) {
    const ln = LN();
    if (!ln || !clubSlug) return; // web / not-native → nothing to do
    const prefs = getReminderPrefs();
    const teams = (memberships || []).map((m) => m.team).filter((t) => prefs[t]);
    try {
        const perm = await ln.checkPermissions?.();
        if (perm && perm.display !== 'granted') {
            const r = await ln.requestPermissions();
            if (!r || r.display !== 'granted') return;
        }
    } catch { /* permission API unavailable → try scheduling anyway */ }

    const notifs = [];
    if (teams.length) {
        const myTeams = teams.map(nrm);
        const now = Date.now();
        const data = await fetch(`/api/${clubSlug}/schedule`).then((r) => r.json()).catch(() => ({ sessions: [] }));
        const sessions = data.sessions || [];
        // The live publication can be a PAST week (recurring schedules aren't re-published weekly, so
        // getLiveSchedule falls back to the most recent past week). The board + ICS roll those dates
        // forward to the current week for display — mirror that here, or every reminder computes a past
        // kickoff and gets skipped (at <= now), so NONE ever fire.
        const pad2 = (n) => String(n).padStart(2, '0');
        const curSunday = new Date(); curSunday.setHours(0, 0, 0, 0); curSunday.setDate(curSunday.getDate() - curSunday.getDay());
        const curSundayStr = `${curSunday.getFullYear()}-${pad2(curSunday.getMonth() + 1)}-${pad2(curSunday.getDate())}`;
        const rollToCurrent = data.publication?.week_start && data.publication.week_start < curSundayStr;
        const dateForDow = (dow) => { const d = new Date(curSunday); d.setDate(d.getDate() + Number(dow)); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
        const seen = new Set();
        sessions.forEach((s) => {
            if (!s.team || !myTeams.includes(nrm(s.team)) || !s.start_time) return;
            if ((s.status || 'active') === 'cancelled') return;
            const dow = Number.isInteger(s.day_of_week) ? s.day_of_week : (s.date ? new Date(`${s.date}T00:00:00`).getDay() : null);
            const sdate = rollToCurrent ? (dow === null ? s.date : dateForDow(dow)) : s.date;
            if (!sdate) return;
            const when = new Date(`${sdate}T${s.start_time}:00`).getTime(); // device-local time
            const at = when - LEAD_MS;
            if (!when || at <= now) return; // past, or less than the lead away
            const id = hashId(`${nrm(s.team)}|${sdate}|${s.start_time}`);
            if (seen.has(id)) return; seen.add(id);
            const label = getNickname(s.team) || s.team;
            notifs.push({
                id, title: s.type === 'match' ? '⚽ משחק מתקרב' : '🏃 אימון מתקרב',
                body: `${label} · היום ${s.start_time}${s.hall ? ' · ' + s.hall : ''}`,
                schedule: { at: new Date(at) },
            });
        });
    }

    try {
        const pending = await ln.getPending?.();
        if (pending?.notifications?.length) await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
        if (notifs.length) await ln.schedule({ notifications: notifs });
    } catch { /* scheduling failed — ignore, retried next run */ }
}
