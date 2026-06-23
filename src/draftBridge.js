// Bridge between the DB draft (normalized sessions) and the manager Preview's
// sheet-shaped model (header row + team rows with day cells). Lets the existing
// preview UI keep working while the source of truth is the DB draft.
import { parseCellContent } from './utils/scheduleUtils';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const PALETTE = ['#fecaca', '#fde68a', '#d9f99d', '#a7f3d0', '#99f6e4', '#bae6fd', '#c7d2fe', '#ddd6fe', '#fbcfe8', '#fecdd3', '#bbf7d0', '#e9d5ff', '#a5f3fc', '#bfdbfe', '#fef08a'];

const pad = (n) => String(n).padStart(2, '0');
const datePlus = (isoWeekStart, days) => {
    const d = new Date(isoWeekStart + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d;
};
const hhmm = (min) => `${pad(Math.floor((((min % 1440) + 1440) % 1440) / 60))}:${pad(min % 60)}`;
const toMin = (t) => { const c = String(t || '').replace(':', '').padStart(4, '0'); return Number(c.slice(0, 2)) * 60 + Number(c.slice(2, 4)); };

const colorForHall = (loc) => {
    if (!loc) return null;
    if (loc.includes('משחק')) return '#ffedd5';
    let hash = 0;
    for (let i = 0; i < loc.length; i++) hash = loc.charCodeAt(i) + ((hash << 5) - hash);
    return PALETTE[Math.abs(hash) % PALETTE.length];
};

// DB draft ({ publication:{week_start}, sessions:[] }) → { headers, teams, rawRows, indices, hallColors }.
export function sessionsToSheet(draft) {
    const weekStart = draft?.publication?.week_start || (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
    const headers = ['קבוצות', 'מאמן'];
    for (let i = 0; i < 7; i++) { const d = datePlus(weekStart, i); headers.push(`${DAY_NAMES[i]} ${d.getDate()}/${d.getMonth() + 1}`); }

    const order = [];
    const byKey = new Map(); // teamKey -> { name, coach, type, row }
    const hallColors = {};

    (draft?.sessions || []).forEach((s) => {
        const key = `${s.team}|${s.coach || ''}`;
        if (!byKey.has(key)) {
            const row = [s.team, s.coach || '', '', '', '', '', '', '', '']; // 2 + 7 days
            byKey.set(key, { name: s.team, coach: s.coach || '', type: s.gender || 'M', row });
            order.push(key);
        }
        const entry = byKey.get(key);
        let di = s.day_of_week;
        if (di === null || di === undefined) { di = s.date ? new Date(s.date + 'T00:00:00').getDay() : 0; }
        const col = 2 + di;
        const text = (s.note && s.note.trim()) ? s.note.trim()
            : `${s.hall || ''} ${s.start_time ? s.start_time.replace(':', '') : ''}${s.end_time ? '-' + s.end_time.replace(':', '') : ''}`.trim();
        entry.row[col] = entry.row[col] ? `${entry.row[col]}\n${text}` : text;
        if (s.hall) hallColors[s.hall] = hallColors[s.hall] || colorForHall(s.hall);
    });

    const teams = order.map((k, i) => { const t = byKey.get(k); return { name: t.name, coach: t.coach, type: t.type, rowIndex: i }; });
    const rawRows = order.map((k) => byKey.get(k).row);
    return { headers, teams, rawRows, indices: { team: 0, coach: 1, type: -1, dayStart: 2 }, hallColors, weekStart };
}

// Preview rows → normalized sessions for PUT /draft. `teams` supplies per-team gender.
export function sheetToSessions(headers, rows, indices, teams, weekStart) {
    const dayStart = indices?.dayStart ?? 2;
    const coachIdx = indices?.coach ?? 1;
    const genderOf = {};
    (teams || []).forEach((t) => { genderOf[`${t.name}|${t.coach || ''}`] = t.type || 'M'; });
    const sessions = [];

    (rows || []).forEach((row) => {
        const team = (row[0] || '').trim();
        if (!team) return;
        const coach = coachIdx !== -1 ? (row[coachIdx] || '').trim() : '';
        const gender = genderOf[`${team}|${coach}`] || 'M';
        for (let i = 0; i < 7; i++) {
            const cell = row[dayStart + i];
            if (!cell || !cell.trim() || cell.toLowerCase().includes('xxx')) continue;
            const d = weekStart ? datePlus(weekStart, i) : null;
            const dateStr = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
            cell.split('\n').forEach((line) => {
                if (!line.trim()) return;
                const { time, location, isMatch } = parseCellContent(line);
                if (!time && !location) return;
                const parts = (time || '').split('-');
                const startMin = parts[0] ? toMin(parts[0]) : null;
                const endMin = parts[1] ? toMin(parts[1]) : (startMin !== null ? startMin + 90 : null);
                const type = isMatch ? 'match' : (line.includes('אתלטיקה') ? 'athletics' : 'training');
                sessions.push({
                    team, coach, gender,
                    hall: location || null,
                    date: dateStr,
                    day_of_week: i,
                    start_time: startMin !== null ? hhmm(startMin) : null,
                    end_time: endMin !== null ? hhmm(endMin) : null,
                    type,
                    status: 'active',
                    note: line.trim(),
                });
            });
        }
    });
    return sessions;
}
