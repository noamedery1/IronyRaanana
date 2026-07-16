import { useState, useEffect, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Manager tool: create / edit / delete teams manually (DB `teams` table), so a brand-new
// club can set up its teams before importing or building any schedule. Teams created here
// show up as empty rows in the schedule builder, ready to fill.
export default function TeamManager({ onChanged }) {
    const [teams, setTeams] = useState([]);
    const [editing, setEditing] = useState(null); // team id being edited, or null = add mode
    const [name, setName] = useState('');
    const [coach, setCoach] = useState('');
    const [gender, setGender] = useState('M');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const slug = getActiveClub().slug;

    const load = useCallback(() => {
        fetch(`/api/${slug}/teams`).then((r) => r.json())
            .then((d) => { if (d.teams) setTeams(d.teams); else if (d.error) setMsg('שגיאה: ' + d.error); })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [slug]);

    useEffect(() => { load(); }, [load]);

    const resetForm = () => { setEditing(null); setName(''); setCoach(''); setGender('M'); };

    const startEdit = (t) => {
        setEditing(t.id); setName(t.name || ''); setCoach(t.coach || ''); setGender(t.gender || 'M');
        setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const save = async () => {
        if (!name.trim()) { setMsg('הקלד שם קבוצה'); return; }
        setBusy(true); setMsg('');
        const body = { name: name.trim(), coach: coach.trim(), gender };
        if (editing) body.id = editing;
        const d = await fetch(`/api/${slug}/teams`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
            body: JSON.stringify(body),
        }).then((r) => r.json()).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error);
        else { setMsg('✓ נשמר ' + name.trim()); resetForm(); load(); onChanged?.(); }
        setBusy(false);
    };

    const remove = async (t) => {
        if (!confirm('למחוק את הקבוצה "' + t.name + '"? (לא ימחק אימונים שכבר שובצו לה בלו"ז)')) return;
        const d = await fetch(`/api/${slug}/teams/${t.id}`, { method: 'DELETE', headers: authHeaders(slug) })
            .then((r) => r.json()).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error);
        else { if (editing === t.id) resetForm(); load(); onChanged?.(); }
    };

    const input = { width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>👥 ניהול קבוצות</h3>
            <p style={{ color: '#64748b', fontSize: '0.88rem', marginTop: '-0.4rem' }}>
                כאן מקימים את קבוצות המועדון. כל קבוצה שתיצור תופיע כשורה ריקה בלוח השיבוץ ("בניית הלו"ז"), מוכנה למילוי.
                <br />שם המאמן אינו חובה — אפשר להשאיר ריק ולשייך מאמנים (עם קוד כניסה) בשלב "👤 ניהול מאמנים".
            </p>

            {/* Add / edit form */}
            <div style={{ background: editing ? '#fff7ed' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1rem', marginBottom: '1.2rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.6rem' }}>{editing ? 'עריכת קבוצה' : 'הוספת קבוצה'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.6rem', alignItems: 'center' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם הקבוצה (למשל: ילדים א')" style={input} />
                    <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="מאמן (לא חובה — משייכים בשלב המאמנים)" style={input} />
                    <select value={gender} onChange={(e) => setGender(e.target.value)} style={{ ...input, width: 'auto' }}>
                        <option value="M">בנים</option>
                        <option value="W">בנות</option>
                    </select>
                </div>
                <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button onClick={save} disabled={busy} style={{ background: '#ff7a18', color: 'white', border: 'none', padding: '0.6rem 1.3rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                        {busy ? 'שומר...' : (editing ? '💾 שמור שינויים' : '➕ הוסף קבוצה')}
                    </button>
                    {editing && <button onClick={resetForm} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' }}>ביטול</button>}
                    {msg && <span style={{ fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</span>}
                </div>
            </div>

            {/* List */}
            <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.5rem' }}>קבוצות ({teams.length})</div>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
                {teams.length === 0 && <div style={{ color: '#94a3b8' }}>אין קבוצות עדיין — הוסף את הקבוצה הראשונה למעלה.</div>}
                {teams.map((t) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.5rem 0.8rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <b>{t.name}</b>
                            <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>{t.gender === 'W' ? 'בנות' : 'בנים'}</span>
                            {t.coach ? <div style={{ color: '#64748b', fontSize: '0.82rem' }}>מאמן: {t.coach}</div> : null}
                        </div>
                        <button onClick={() => startEdit(t)} style={{ background: 'none', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer' }}>עריכה</button>
                        <button onClick={() => remove(t)} style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer' }}>מחק</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
