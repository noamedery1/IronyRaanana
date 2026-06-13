// Server-side, browser-free schedule parsing + ICS feed building.
// Mirrors the pure helpers from src/utils/scheduleUtils.js (no file-saver / exceljs deps),
// so the Express server can serve a live per-team calendar feed.
import Papa from 'papaparse';

// --- parse a single schedule cell line into { time, location, isMatch, status } ---
export function parseCellContent(text) {
    if (!text) return { time: '', location: '', isMatch: false, status: 'normal' };
    let status = 'normal';
    let cleanText = text;

    if (text.match(/x|בוטל|canceled|cancelled/i)) {
        status = 'cancelled';
        cleanText = text.replace(/x|בוטל|canceled|cancelled/gi, '').replace(/^[\s\-:–]+/, '').trim();
    } else if (text.includes('!') || text.includes('⚠️') || text.includes('שינוי') || text.includes('CHANGE')) {
        status = 'changed';
        cleanText = text.replace(/[!⚠️]/g, '').replace(/(שינוי|CHANGE)/g, '').trim();
    }

    const isMatch = cleanText.includes('משחק') || cleanText.includes('🏀');
    let formatted = cleanText.replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, '$1:$2');
    const timeRegex = /\b\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\b/g;
    const matches = formatted.match(timeRegex);

    let time = '';
    let location = formatted;
    if (matches && matches.length > 0) {
        time = matches[matches.length - 1];
        matches.forEach(m => { location = location.replace(m, ''); });
    }
    location = location
        .replace('משחק', '')
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, '')
        .trim();
    return { time: time.trim(), location, isMatch, status };
}

// --- "ראשון 14/6" -> Date (local) ---
export function parseHeaderDate(header) {
    if (!header) return null;
    const m = header.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : 2026;
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day);
}

export function parseTime(timeStr) {
    if (!timeStr) return { h: 0, m: 0 };
    const [h, m] = timeStr.split(':').map(Number);
    return { h: h || 0, m: m || 0 };
}

// --- ICS escaping + floating-local timestamp (no TZ → shows as wall-clock for the viewer) ---
const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const pad = (n) => String(n).padStart(2, '0');
const floatStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

export function buildICS(events, calendarName = 'Schedule') {
    let s = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Raanana//Scheduler//HE\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n';
    s += `X-WR-CALNAME:${icsEscape(calendarName)}\r\nX-PUBLISHED-TTL:PT1H\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n`;
    events.forEach(ev => {
        if (!ev.start || !ev.end) return;
        s += 'BEGIN:VEVENT\r\n';
        s += `UID:${ev.uid}@raanana.scheduler\r\n`;
        s += `DTSTAMP:${floatStamp(ev.start)}\r\n`;
        s += `DTSTART:${floatStamp(ev.start)}\r\n`;
        s += `DTEND:${floatStamp(ev.end)}\r\n`;
        s += `SUMMARY:${icsEscape(ev.title)}\r\n`;
        if (ev.location) s += `LOCATION:${icsEscape(ev.location)}\r\n`;
        if (ev.details) s += `DESCRIPTION:${icsEscape(ev.details)}\r\n`;
        s += 'END:VEVENT\r\n';
    });
    s += 'END:VCALENDAR';
    return s;
}

// --- full pipeline: live CSV text + team label -> ICS string (or null if team not found) ---
export function buildTeamICSFromCsv(csvText, teamParam) {
    const rows = Papa.parse(csvText, { header: false }).data;
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].includes('קבוצות')) { headerRowIndex = i; break; }
    }
    if (headerRowIndex === -1) return null;

    const headerRow = rows[headerRowIndex];
    const dataRows = rows.slice(headerRowIndex + 1);
    const coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
    let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));
    if (dayStartIndex === -1) dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;

    let teamRow = null, teamName = '', coach = '';
    for (const row of dataRows) {
        const name = row[0];
        if (!name || !name.trim()) continue;
        if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) continue;
        const c = (coachIndex !== -1 && row[coachIndex]) ? row[coachIndex].trim() : '';
        const label = c ? `${name.trim()} - ${c}` : name.trim();
        if (label === teamParam || name.trim() === teamParam) { teamRow = row; teamName = name.trim(); coach = c; break; }
    }
    if (!teamRow) return null;

    const events = [];
    for (let i = 0; i < 7; i++) {
        const colIndex = dayStartIndex + i;
        const content = teamRow[colIndex];
        if (!content || !content.trim() || content.toLowerCase().includes('xxx')) continue;
        const date = parseHeaderDate(headerRow[colIndex] || '');
        if (!date) continue;
        content.split('\n').forEach((line, lineIdx) => {
            if (!line.trim()) return;
            const { time, location, isMatch, status } = parseCellContent(line);
            if (status === 'cancelled') return;
            const parts = (time || '').split('-');
            const startT = parseTime(parts[0]);
            const endT = parts[1] ? parseTime(parts[1]) : { h: startT.h + 1, m: startT.m + 30 };
            const start = new Date(date); start.setHours(startT.h, startT.m, 0, 0);
            const end = new Date(date); end.setHours(endT.h, endT.m, 0, 0);
            events.push({
                title: `${isMatch ? '🏀 משחק' : 'אימון'} - ${teamName}`,
                location,
                details: `קבוצת ${teamName}${coach ? ' · מאמן ' + coach : ''}`,
                start, end,
                uid: `${teamName}-${coach}-${i}-${lineIdx}-${(time || '').replace(/[^\d]/g, '')}`.replace(/\s+/g, '_')
            });
        });
    }
    return buildICS(events, `לו"ז ${teamName}${coach ? ' - ' + coach : ''}`);
}
