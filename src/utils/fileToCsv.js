// Convert an uploaded schedule file (Word .docx or a 2-D table) into the CSV shape
// the importer expects: a header row with "קבוצות" + day columns, then one row per team.
// Word tables carry real cell structure and logical (correct) text, so this is reliable.

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

// A 2-D array of cells → CSV in the app's shape. Detects the header row (the row with
// day names), the team column (the non-day column with the most filled cells), and emits
// קבוצות + the present day columns.
export function tableToCsv(rows) {
    const grid = rows.map((r) => r.map(clean));
    const hi = grid.findIndex((r) => r.filter((c) => DAYS.includes(c)).length >= 2);
    if (hi < 0) throw new Error('לא זוהתה טבלת לו"ז (חסרות כותרות ימים: ראשון, שני …).');
    const header = grid[hi];
    const dayCols = {}; header.forEach((c, ci) => { if (DAYS.includes(c)) dayCols[ci] = c; });
    const body = grid.slice(hi + 1);
    const nonDay = header.map((_, ci) => ci).filter((ci) => !(ci in dayCols));
    const teamCol = nonDay.sort((a, b) =>
        body.filter((r) => r[b]).length - body.filter((r) => r[a]).length)[0] ?? 0;
    const present = DAYS.filter((d) => Object.values(dayCols).includes(d)
        && body.some((r) => { const ci = Object.keys(dayCols).find((k) => dayCols[k] === d); return ci != null && r[ci]; }));
    const esc = (s) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const out = [['קבוצות', ...present].map(esc).join(',')];
    for (const r of body) {
        const team = clean(r[teamCol]);
        if (!team || /באנר|banner/i.test(team)) continue;
        const cells = present.map((d) => {
            const ci = Object.keys(dayCols).find((k) => dayCols[k] === d);
            return ci != null ? clean(r[ci]) : '';
        });
        if (!cells.some(Boolean)) continue; // skip section-label / empty rows
        out.push([team, ...cells].map(esc).join(','));
    }
    if (out.length < 2) throw new Error('לא נמצאו קבוצות בטבלה.');
    return '﻿' + out.join('\n');
}

// Word (.docx) → CSV. Uses mammoth to get HTML tables, picks the one that has day columns.
export async function docxToCsv(file) {
    const mammoth = await import('mammoth');
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    if (!tables.length) throw new Error('לא נמצאה טבלה בקובץ ה-Word.');
    // choose the table whose text mentions the most day names
    const score = (t) => DAYS.filter((d) => t.textContent.includes(d)).length;
    const table = tables.sort((a, b) => score(b) - score(a))[0];
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
        [...tr.querySelectorAll('td,th')].map((td) => td.textContent));
    return tableToCsv(rows);
}
