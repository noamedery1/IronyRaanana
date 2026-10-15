// Parse a club "weekend games" PDF (one game per row: יום · מגרש · שעה · יריבה · מאמן ·
// הקבוצה · בית/חוץ) into merge entries the schedule draft understands. The generic
// table→grid extractor (fileToCsv) merges adjacent game rows into one band in this dense
// layout, so this parser keeps FINE text rows (one line = one game) and buckets each item
// into a column by the header labels' x-centres. Best-effort: the manager reviews the
// merged result in the existing Preview before publishing.

const DAY_IDX = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
const DAY_RE = /ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת/;

// Column header label → entry key. 'בית/חוץ' sometimes splits; match on 'בית'.
const COLS = [
    { key: 'day', re: /^יום$/ },
    { key: 'field', re: /^מגרש$/ },
    { key: 'time', re: /^שעה$/ },
    { key: 'opponent', re: /^יריבה$/ },
    { key: 'coach', re: /^מאמן$/ },
    { key: 'team', re: /^הקבוצה$/ },
    { key: 'homeAway', re: /בית\/?חוץ|^בית$/ },
];

const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
// Re-glue a time the PDF split into separate items: "1 6 :00" / "16 :00" → "16:00",
// "15:00 - 16:30" → "15:00-16:30".
const glueTime = (s) => clean(s).replace(/(\d)\s+(?=[\d:])/g, '$1').replace(/\s*[-–]\s*/g, '-');
const firstTime = (s) => { const m = glueTime(s).match(/\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?/); return m ? m[0] : ''; };
// Strip apostrophes/quotes + collapse spaces for team-name matching against the draft.
export const normTeam = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();

const pad2 = (n) => String(n).padStart(2, '0');
const fmtYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dmyToDate = (d, mo, y) => {
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    return new Date(y, mo - 1, d);
};
// Parse a date out of text → { date, hasYear } or null. A dd/mm/yy (with year) is stronger than a
// bare dd/mm, so callers can prefer it over a false dd/mm pulled from split digits.
const parseDMY = (str) => {
    const m = (str || '').match(/(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\s*[./-]\s*(\d{2,4}))?/);
    if (!m) return null;
    const date = dmyToDate(+m[1], +m[2], m[3] ? +m[3] : new Date().getFullYear());
    return date ? { date, hasYear: !!m[3] } : null;
};
// Glue consecutive all-digit tokens into one number ("1","9","/","10" → "19/10"), so a date whose
// digits pdfjs split across items reassembles.
const glueDigits = (toks) => {
    const out = [];
    for (const t of toks) {
        if (/^\d+$/.test(t) && out.length && /^\d+$/.test(out[out.length - 1])) out[out.length - 1] += t;
        else out.push(t);
    }
    return out.join('');
};
// Find a date in a line's tokens. pdfjs emits Hebrew (RTL) date tokens split AND sometimes reversed
// ("6","2","/","4","0","/","25" = 25/04/26), so glue the digit/slash tokens both forward and
// reversed and prefer whichever yields a full dd/mm/yy (with year).
const findDate = (strs) => {
    const toks = (strs || []).map((s) => (s || '').trim()).filter((s) => /^[\d/.\-]+$/.test(s));
    if (!toks.length) return null;
    const cands = [parseDMY(glueDigits(toks)), parseDMY(glueDigits([...toks].reverse()))].filter(Boolean);
    if (!cands.length) return null;
    return (cands.find((c) => c.hasYear) || cands[0]).date;
};

// Cluster y-values into fine rows (one visual text line each).
function fineRows(items, tol = 5) {
    const sorted = [...items].sort((a, b) => a.y - b.y);
    const rows = [];
    let cur = null;
    for (const it of sorted) {
        if (!cur || it.y - cur.y > tol) { cur = { y: it.y, items: [] }; rows.push(cur); }
        cur.items.push(it);
    }
    return rows;
}

// items: [{x, y, str}] for ONE page (y already top-down). Returns { entries, warnings }.
// mainDow: default weekday (from the title date) for rows whose day column is empty.
export function extractGames(items, mainDow = 6 /* שבת */) {
    const rows = fineRows(items);
    // Find the header row: the fine row carrying the column labels.
    let header = null;
    for (const r of rows) {
        const txt = r.items.map((i) => i.str).join(' ');
        if (/הקבוצה/.test(txt) && /שעה/.test(txt)) { header = r; break; }
    }
    if (!header) throw new Error('לא זוהתה טבלת משחקים (חסרה שורת כותרת עם "הקבוצה" ו"שעה").');

    // Column centres from the header labels (x per key). Robust to x shifts between files.
    const centres = [];
    header.items.forEach((it) => {
        const t = clean(it.str);
        const col = COLS.find((c) => c.re.test(t));
        if (col && !centres.find((c) => c.key === col.key)) centres.push({ key: col.key, x: it.x });
    });
    if (!centres.find((c) => c.key === 'team') || !centres.find((c) => c.key === 'time')) {
        throw new Error('לא זוהו העמודות "הקבוצה"/"שעה" בקובץ.');
    }
    const colOf = (x) => centres.reduce((bk, c) => Math.abs(c.x - x) < Math.abs(bk.x - x) ? c : bk, centres[0]).key;

    // Title/main date: the first dd/mm/yy in the rows above the header (e.g. "25/04/26 שבת").
    // Gives the baseline week (its Sunday) so every game without its own date lands on the right
    // week, and the main weekday fallback for day-less rows.
    let mainDate = null;
    for (const r of rows) {
        if (r.y > header.y) break;
        const d = findDate(r.items.map((i) => i.str));
        if (d) { mainDate = d; break; }
    }
    const weekSunday = mainDate ? (() => { const s = new Date(mainDate); s.setDate(s.getDate() - s.getDay()); return s; })() : null;
    if (mainDate) mainDow = mainDate.getDay();

    const entries = [];
    const warnings = [];
    // A team name sometimes wraps onto its own line ("צו פיוס" / "צפון" below "נערים ב'"),
    // belonging to the line directly ABOVE. Track that previous line (game or skipped) so a
    // pure-suffix line folds into the right team instead of corrupting a neighbour.
    const SUFFIX_RE = /^(צו פיוס|צו|פיוס|צפון)$/;
    let prev = null; // { setTeam(txt): rewrite the previous line's team, text: current team text }
    for (const r of rows) {
        if (r.y <= header.y + 2) continue; // skip title + header rows
        const buckets = {};
        for (const it of r.items) { const k = colOf(it.x); (buckets[k] ||= []).push({ x: it.x, str: it.str }); }
        const val = (k) => clean((buckets[k] || []).map((o) => o.str).join(' '));
        const strs = (k) => (buckets[k] || []).map((o) => o.str);
        const teamRaw = val('team');
        const time = firstTime(val('time'));
        // A Hebrew day name can be split across items in reading (RTL) order, e.g. "ש"(x54)+"ישי"
        // (x38) for שישי. Reconstruct by x (both directions) so the day isn't lost → the game would
        // otherwise fall back to the main weekday and land on the wrong day.
        const dayAsc = [...(buckets.day || [])].sort((a, b) => a.x - b.x).map((o) => o.str).join('');
        const dayDesc = [...(buckets.day || [])].sort((a, b) => b.x - a.x).map((o) => o.str).join('');
        const dayName = (dayDesc.match(DAY_RE) || dayAsc.match(DAY_RE) || [])[0] || '';
        const rowDate = findDate(strs('day')); // explicit per-row date (midweek games)

        // A continuation line below a game carries its DATE and/or a team-suffix (צו פיוס / צפון),
        // with no time and no day-name of its own — fold both into the previous game. This is how
        // midweek games get their real (next-week) date, which sits on the suffix line below.
        if (prev && !time && !dayName && (SUFFIX_RE.test(teamRaw) || (!teamRaw && rowDate))) {
            if (SUFFIX_RE.test(teamRaw)) prev.setTeam(`${prev.text} ${teamRaw}`);
            if (rowDate) prev.setDate(rowDate);
            continue;
        }
        if (!teamRaw) { prev = null; continue; }

        // A real game line carries a team AND (a time or a day). A team with neither is a
        // listing whose game isn't on a parseable baseline (the PDF groups some teams over two
        // lines) — flag it for the manager rather than guess, but still let a following suffix
        // fold into it so the warning names the right team.
        if (!time && !dayName) {
            const w = { team: normTeam(teamRaw) };
            warnings.push(w);
            prev = { text: w.team, setTeam: (t) => { w.team = normTeam(t); prev.text = w.team; }, setDate: () => {} };
            continue;
        }

        const dow = dayName ? DAY_IDX[dayName] : mainDow;
        // Date: the row's own date if present, else baseline week's Sunday + weekday (no own date =
        // a weekend game on the main weekend). hasOwnDate marks games that carry an explicit date
        // (midweek → possibly a different/next week), which the caller routes by.
        const weekendDate = weekSunday ? fmtYMD(new Date(weekSunday.getFullYear(), weekSunday.getMonth(), weekSunday.getDate() + dow)) : null;
        const entry = {
            team: normTeam(teamRaw),
            dow,
            date: rowDate ? fmtYMD(rowDate) : weekendDate,
            hasOwnDate: !!rowDate,
            time,
            opponent: val('opponent'),
            homeAway: /חוץ/.test(val('homeAway')) ? 'חוץ' : /בית/.test(val('homeAway')) ? 'בית' : '',
            field: val('field'),
        };
        entries.push(entry);
        prev = {
            text: entry.team,
            setTeam: (t) => { entry.team = normTeam(t); prev.text = entry.team; },
            setDate: (d) => { entry.date = fmtYMD(d); entry.hasOwnDate = true; },
        };
    }
    // Resolve warnings to strings now that suffixes have folded in.
    const warn = warnings.map((w) => `לא זוהה משחק ברור עבור "${w.team}" — בדוק/הוסף ידנית אם צריך.`);
    if (!entries.length) warn.push('לא נמצאו משחקים בקובץ.');
    return { entries, warnings: warn, weekStart: weekSunday ? fmtYMD(weekSunday) : null };
}

// Build the schedule cell line parents see. "משחק" marks it as a game (amber card + badge);
// the rest (opponent · home/away · field) rides along as the location text.
export function gameLine(e) {
    const bits = [];
    if (e.opponent) bits.push(`נגד ${e.opponent}`);
    if (e.homeAway) bits.push(`(${e.homeAway})`);
    if (e.field) bits.push(`· ${e.field}`);
    return `🏀 משחק ${e.time}${bits.length ? ' ' + bits.join(' ') : ''}`.trim();
}

// Browser entry point: PDF file → { entries, warnings }. Uses pdfjs like fileToCsv.
export async function gamesPdfToEntries(file) {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const all = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        tc.items.filter((it) => it.str && it.str.trim())
            .forEach((it) => all.push({ x: it.transform[4], y: vp.height - it.transform[5], str: it.str }));
    }
    if (!all.length) throw new Error('לא הצלחנו לקרוא טקסט מה-PDF.');
    return extractGames(all);
}
