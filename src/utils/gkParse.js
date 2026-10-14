// Parse a goalkeeper-coach's pasted WhatsApp text into merge entries + a tidy WhatsApp
// message. The coach writes team(s) then a time range, alternating, with a day name in the
// header, e.g.:
//   אימון שוערים להיום יום ראשון
//   נוער
//   15:00 - 15:30
//   ילדים א + ילדים ב
//   16:00 - 16:30
// Several teams on one line are joined with "+". The exact date in these messages is often
// malformed (e.g. "11.19.26"), so we key off the DAY NAME only — the schedule grid is
// day-of-week based anyway.

const DAY_IDX = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
const DAY_RE = /ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת/;
const TIME_RE = /(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/;
const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

// text → { entries:[{team,dow,timeRange,line}], dayName, dow, warnings }
export function gkTextToEntries(text) {
    const raw = (text || '').replace(/\r/g, '');
    const dayName = (raw.match(DAY_RE) || [])[0] || '';
    const dow = dayName ? DAY_IDX[dayName] : null;
    const warnings = [];
    if (dow === null) warnings.push('לא זוהה יום בטקסט (ראשון, שני …). בחר יום ידנית.');

    const lines = raw.split('\n').map(clean).filter(Boolean);
    const entries = [];
    let pendingTeams = null; // the last team line seen, awaiting its time range
    for (const line of lines) {
        const tm = line.match(TIME_RE);
        if (tm) {
            const timeRange = `${tm[1]}-${tm[2]}`;
            if (!pendingTeams) { warnings.push(`שעה ללא קבוצה: ${timeRange}`); continue; }
            pendingTeams.split('+').map(clean).filter(Boolean).forEach((team) => {
                entries.push({ team, dow, timeRange, line: `🧤 אימון שוערים ${timeRange}` });
            });
            pendingTeams = null;
            continue;
        }
        // Not a time line. Skip header/greeting lines (they mention "שוערים"/"בוקר"/the day),
        // keep anything else as the team(s) for the next time range.
        if (DAY_RE.test(line) || /שוער|בוקר|שלום|היום|להיום/.test(line)) continue;
        pendingTeams = line;
    }
    if (!entries.length) warnings.push('לא נמצאו אימוני שוערים בטקסט.');
    return { entries, dayName, dow, warnings };
}

// Build a tidy WhatsApp message from the parsed entries (grouped by time range, in order).
export function gkWhatsApp(entries, dayName) {
    if (!entries || !entries.length) return '';
    const byTime = new Map();
    entries.forEach((e) => { (byTime.get(e.timeRange) || byTime.set(e.timeRange, []).get(e.timeRange)).push(e.team); });
    const order = [...byTime.keys()].sort((a, b) => a.localeCompare(b));
    let msg = `🧤 *אימון שוערים*${dayName ? ` · יום ${dayName}` : ''}\n\n`;
    order.forEach((tr) => { msg += `${tr} — ${byTime.get(tr).join(' + ')}\n`; });
    msg += `\nבהצלחה! 💪`;
    return msg;
}
