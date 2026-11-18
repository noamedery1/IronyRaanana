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
        const { sessions = [] } = await fetch(`/api/${clubSlug}/schedule`).then((r) => r.json()).catch(() => ({ sessions: [] }));
        const seen = new Set();
        sessions.forEach((s) => {
            if (!s.team || !myTeams.includes(nrm(s.team)) || !s.date || !s.start_time) return;
            if ((s.status || 'active') === 'cancelled') return;
            const when = new Date(`${s.date}T${s.start_time}:00`).getTime(); // device-local time
            const at = when - LEAD_MS;
            if (!when || at <= now) return; // past, or less than the lead away
            const id = hashId(`${nrm(s.team)}|${s.date}|${s.start_time}`);
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
