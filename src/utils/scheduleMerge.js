// Merge extra entries (games, goalkeeper trainings) INTO the existing schedule draft,
// appending a line to the right team's right weekday cell — never replacing. Shared by the
// games-PDF importer and the goalkeeper-schedule importer. Team matching is fuzzy because
// PDF text extraction fragments Hebrew ("לדים א" for "ילדים א", "ט רום א" for "טרום א"), so
// we match on space-stripped names + a small edit-distance fallback; anything not confidently
// matched is returned as `unmatched` for the manager to fix in the preview.

const noSpace = (s) => (s || '').toString().replace(/['"׳״\s]/g, '');

function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
        let cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
        }
        prev = cur;
    }
    return prev[n];
}

// Best draft-team name for a parsed team string, or '' if none is close enough.
export function matchTeam(name, teamNames) {
    const target = noSpace(name);
    if (!target) return '';
    let best = '', bestD = Infinity;
    for (const t of teamNames) {
        const d = lev(target, noSpace(t));
        if (d < bestD) { bestD = d; best = t; }
    }
    const tol = Math.max(1, Math.round(target.length * 0.2));
    return bestD <= tol ? best : '';
}

// entries: [{ team, dow, line }]. rows: sheet rawRows ([team, coach, ...7 day cells]).
// Returns { rows: newRows, matched: [...], unmatched: [...] } — rows is a deep-ish copy with
// the lines appended (dedup: an identical line already in the cell isn't added twice).
export function mergeEntries(rows, dayStart, entries) {
    const out = rows.map((r) => [...r]);
    const names = out.map((r) => (r[0] || '').trim()).filter(Boolean);
    const rowOf = {};
    out.forEach((r, i) => { const k = noSpace(r[0]); if (k && !(k in rowOf)) rowOf[k] = i; });

    const matched = [], unmatched = [];
    for (const e of entries) {
        const hit = matchTeam(e.team, names);
        if (!hit) { unmatched.push(e); continue; }
        const ri = rowOf[noSpace(hit)];
        const col = dayStart + e.dow;
        const existing = out[ri][col] || '';
        const already = existing.split('\n').some((l) => l.trim() === e.line.trim());
        if (!already) out[ri][col] = existing ? `${existing}\n${e.line}` : e.line;
        matched.push({ ...e, team: hit });
    }
    return { rows: out, matched, unmatched };
}
