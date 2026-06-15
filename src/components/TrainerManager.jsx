import { useState, useEffect, useCallback } from 'react';

// Manager tool: add / list / delete trainers (Name + initial Code), so the manager
// sets up a trainer up-front, then shares the trainer link. No manual sheet editing.
export default function TrainerManager({ liveApi }) {
    const [trainers, setTrainers] = useState([]);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [teams, setTeams] = useState('');
    const [pw, setPw] = useState(() => localStorage.getItem('managerPushPw') || '');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const post = useCallback((action, extra) => fetch(liveApi, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, password: pw, ...extra }),
    }).then((r) => r.json()), [liveApi, pw]);

    const load = useCallback(() => {
        post('listTrainers', {})
            .then((d) => {
                if (d.trainers) { setTrainers(d.trainers); if (d.trainers.length === 0) setMsg('אין מאמנים בגיליון Trainers עדיין.'); }
                else if (d.error) setMsg('שגיאה בטעינה: ' + d.error);
            })
            .catch(() => setMsg('שגיאת תקשורת בטעינת הרשימה'));
    }, [post]);

    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!name.trim() || !code.trim()) { setMsg('מלא שם וקוד'); return; }
        setBusy(true); setMsg(''); localStorage.setItem('managerPushPw', pw);
        const d = await post('addTrainer', { name, code, teams }).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error);
        else { setMsg('✓ נוסף ' + name); setName(''); setCode(''); setTeams(''); load(); }
        setBusy(false);
    };

    const remove = async (n) => {
        if (!confirm('למחוק את המאמן "' + n + '"?')) return;
        const d = await post('deleteTrainer', { name: n }).catch(() => ({ error: 'תקשורת' }));
        if (d.error) setMsg('שגיאה: ' + d.error); else load();
    };

    const input = { width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>👤 ניהול מאמנים</h3>
            <p style={{ color: '#666', marginTop: 0 }}>הוסיפו מאמן עם קוד ראשוני, ואז שלחו לו את לינק המאמנים. רק מי שמופיע כאן יכול להיכנס.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם המאמן (כמו בלוח)" style={input} />
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="קוד ראשוני" style={input} />
                <input value={teams} onChange={(e) => setTeams(e.target.value)} placeholder="קבוצות (אופציונלי)" style={input} />
            </div>
            <div style={{ marginTop: '0.6rem' }}>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="סיסמת מנהל (אם הוגדרה בשרת)" style={input} />
            </div>
            <button onClick={add} disabled={busy} style={{ marginTop: '0.8rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.7rem 1.3rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'מוסיף...' : '➕ הוסף מאמן'}
            </button>
            {msg && <span style={{ marginInlineStart: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</span>}

            <h4 style={{ margin: '1.6rem 0 0.6rem' }}>מאמנים קיימים ({trainers.length})</h4>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
                {trainers.length === 0 && <div style={{ color: '#94a3b8' }}>אין מאמנים עדיין.</div>}
                {trainers.map((t) => (
                    <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.5rem 0.8rem' }}>
                        <div style={{ flex: 1 }}><b>{t.name}</b>{t.teams ? <span style={{ color: '#64748b', fontSize: '0.85rem' }}> — {t.teams}</span> : null}</div>
                        <button onClick={() => remove(t.name)} style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 6, padding: '0.3rem 0.7rem', cursor: 'pointer' }}>מחק</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
