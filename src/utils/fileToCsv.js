// Convert an uploaded schedule file (Word .docx or a 2-D table) into the CSV shape
// the importer expects: a header row with "קבוצות" + day columns, then one row per team.
// Word tables carry real cell structure and logical (correct) text, so this is reliable.

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

// Tidy a reconstructed PDF cell: collapse spaces, re-glue digits/time ranges the PDF
// split into separate items (e.g. "1 9:30", "15:00 - 16:30").
const tidyCell = (s) => (s || '')
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s+(\d)/g, '$1$2')
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1-$2')
    .trim();

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
// Cluster numeric values into sorted centers (values within `tol` merge).
const clusterCenters = (vals, tol) => {
    const s = [...vals].sort((a, b) => a - b); const c = []; let g = [];
    for (const v of s) { if (!g.length || v - g[g.length - 1] <= tol) g.push(v); else { c.push(g.reduce((a, b) => a + b) / g.length); g = [v]; } }
    if (g.length) c.push(g.reduce((a, b) => a + b) / g.length);
    return c;
};
const nearestIdx = (centers, v) => centers.reduce((bi, c, i) => Math.abs(c - v) < Math.abs(centers[bi] - v) ? i : bi, 0);

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

// One PDF page's text items → a 2-D grid (bands × columns). Bands group the fine text
// rows of one table row (a cell's time+location lines) using vertical-gap detection, so
// each team ends up on ONE grid row regardless of how many lines its cells have.
function pageItemsToGrid(items) {
    const rowC = clusterCenters(items.map((i) => i.y), 4);      // fine rows
    const gaps = rowC.slice(1).map((v, i) => v - rowC[i]);
    const thresh = (median(gaps.filter((g) => g > 0)) || 12) * 1.7;
    const bands = [[0]];
    for (let i = 1; i < rowC.length; i++) (rowC[i] - rowC[i - 1] > thresh) ? bands.push([i]) : bands[bands.length - 1].push(i);
    const bandOfFine = (fi) => bands.findIndex((b) => b.includes(fi));
    const colC = clusterCenters(items.map((i) => i.x), 22);     // columns
    const grid = bands.map(() => colC.map(() => []));
    for (const it of items) {
        const b = bandOfFine(nearestIdx(rowC, it.y));
        const c = nearestIdx(colC, it.x);
        if (b >= 0) grid[b][c].push(it);
    }
    // pdfjs returns each text item in logical order already (no reversal). Order items
    // top-to-bottom then left-to-right so time ranges (LTR) stay intact; Hebrew phrases
    // come as single items so their internal order is preserved.
    return grid.map((row) => row.map((cell) =>
        tidyCell(cell.sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((i) => i.str).join(' '))));
}

// PDF (.pdf) → CSV. Extracts each page's table grid and concatenates; tableToCsv then
// finds the header (day names) + team column. Preview lets the manager fix anything.
export async function pdfToCsv(file) {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const rows = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = tc.items.filter((it) => it.str && it.str.trim())
            .map((it) => ({ x: it.transform[4], y: vp.height - it.transform[5], str: it.str }));
        if (items.length) rows.push(...pageItemsToGrid(items));
    }
    if (!rows.length) throw new Error('לא הצלחנו לקרוא טקסט מה-PDF.');
    return tableToCsv(rows);
}
