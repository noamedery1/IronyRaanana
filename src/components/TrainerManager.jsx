import { useState, useEffect, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Manager tool: add / edit / delete trainers (in the DB). One row per trainer (teams
// merged), search + sort by name, team selection from the DB teams list (+ free-text extra).
export default function TrainerManager() {
    const [trainers, setTrainers] = useState([]);
    const [boardTeams, setBoardTeams] = useState([]);
    const [search, setSearch] = useState('');
    const [editing, setEditing] = useState(null); // name being edited, or null = add mode
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [sel, setSel] = useState({});   // selected team -> bool
    const [extra, setExtra] = useState(''); // free-text extra teams (comma separated)
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const slug = getActiveClub().slug;

    const load = useCallback(() => {
        fetch(`/api/${slug}/trainers`).then((r) => r.json())
            .then((d) => { if (d.trainers) setTrainers(d.trainers); else if (d.error) setMsg('שגיאה: ' + d.error); })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [slug]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        fetch(`/api/${slug}/teams`).then((r) => r.json())
            .then((d) => { if (d.teams) setBoardTeams(d.teams.map((t) => t.name).sort((a, b) => a.localeCompare(b, 'he'))); })
            .catch(() => { /* server may be down in dev */ });
    }, [slug]);

    const resetForm = () => { setEditing(null); setName(''); setCode(''); setSel({}); setExtra(''); };

    const startEdit = (t) => {
        setEditing(t.name); setName(t.name); setCode('');
        const map = {};
        (t.teams || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((tm) => { map[tm] = true; });
        setSel(map);
        // teams not in the board list go into the free-text box
        const extras = (t.teams || '').split(',').map((x) => x.trim()).filter(Boolean).filter((tm) => !boardTeams.includes(tm));
        setExtra(extras.join(', '));
        setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const save = async () => {
        if (!name.trim()) { setMsg('הקלד שם'); return; }
        if (!editing && !code.trim()) { setMsg('מאמן חדש דורש קוד'); return; }
        const teams = [
            ...boardTeams.filter((tm) => sel[tm]),
            ...extra.split(',').map((x) => x.trim()).filter(Boolean),
        ];
        // de-dup
        const uniq = [...new Set(teams)].join(', ');
        setBusy(true); setMsg('');
        const d = await fetch(`/api/${slug}/trainers`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
            body: JSON.stringify({ name, code, teams: uniq }),
        }).then((r) => r.json()).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error);
        else { setMsg('✓ נשמר ' + name); resetForm(); load(); }
        setBusy(false);
    };

    const remove = async (n) => {
        if (!confirm('למחוק את המאמן "' + n + '"?')) return;
        const d = await fetch(`/api/${slug}/trainers/${encodeURIComponent(n)}`, { method: 'DELETE', headers: authHeaders(slug) })
            .then((r) => r.json()).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error); else { if (editing === n) resetForm(); load(); }
    };

    const filtered = trainers.filter((t) => t.name.includes(search.trim()));
    const input = { width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>👤 ניהול מאמנים</h3>

            {/* Add / edit form */}
            <div style={{ background: editing ? '#fff7ed' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1rem', marginBottom: '1.2rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.6rem' }}>{editing ? 'עריכת מאמן: ' + editing : 'הוספת מאמן'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם המאמן" disabled={!!editing} style={{ ...input, background: editing ? '#f1f5f9' : '#fff' }} />
                    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={editing ? 'קוד חדש (ריק = ללא שינוי)' : 'קוד ראשוני'} style={input} />
                </div>

                <div style={{ margin: '0.8rem 0 0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>קבוצות</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.3rem', maxHeight: 180, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem' }}>
                    {boardTeams.length === 0 && <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>טוען קבוצות...</span>}
                    {boardTeams.map((tm) => (
                        <label key={tm} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                            <input type="checkbox" checked={!!sel[tm]} onChange={() => setSel((s) => ({ ...s, [tm]: !s[tm] }))} /> {tm}
                        </label>
                    ))}
                </div>
                <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="קבוצות נוספות (מופרדות בפסיק) — אם לא ברשימה" style={{ ...input, marginTop: '0.5rem' }} />

                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button onClick={save} disabled={busy} style={{ background: '#ff7a18', color: 'white', border: 'none', padding: '0.6rem 1.3rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                        {busy ? 'שומר...' : (editing ? '💾 שמור שינויים' : '➕ הוסף מאמן')}
                    </button>
                    {editing && <button onClick={resetForm} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' }}>ביטול</button>}
                    {msg && <span style={{ fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</span>}
                </div>
            </div>

            {/* Search + list */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 חיפוש מאמן לפי שם" style={{ ...input, marginBottom: '0.8rem' }} />
            <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.5rem' }}>מאמנים ({filtered.length})</div>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
                {filtered.length === 0 && <div style={{ color: '#94a3b8' }}>אין תוצאות.</div>}
                {filtered.map((t) => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.5rem 0.8rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <b>{t.name}</b>
                            {t.teams ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>{t.teams}</div> : <div style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>ללא קבוצות</div>}
                        </div>
                        <button onClick={() => startEdit(t)} style={{ background: 'none', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer' }}>עריכה</button>
                        <button onClick={() => remove(t.name)} style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer' }}>מחק</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
